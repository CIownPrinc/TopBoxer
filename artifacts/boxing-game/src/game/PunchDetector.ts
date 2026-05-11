/**
 * Layers 2 & 3 — Gesture Recognition + Game Action
 *
 * Per-hand state machine:
 *   IDLE → COCKING → PUNCHING → COOLDOWN → IDLE
 *        ↘ PUNCHING (direct jab/hook from IDLE)
 *
 * Gestures:
 *   JAB    – fast upward (Y-negative) motion from IDLE
 *   HOOK   – fast lateral (X-dominant) motion from IDLE
 *   UPPERCUT – fast downward (Y-positive) motion from IDLE
 *   CHARGE – wind-up (vy positive, slow) → fast forward release
 *   BLOCK  – both wrists above face level, low velocity
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { HandSmoother } from "./HandSmoother";
import type { SmoothedFrame, Vec3 } from "./HandSmoother";

// ── Exported types ──────────────────────────────────────────────────────────
export type PunchType = "jab" | "hook" | "uppercut" | "charge";

export interface PunchEvent {
  hand: "left" | "right";
  type: PunchType;
  force: number;       // 0–1 (normalised from velocity)
  confidence: number;  // 0–1 (gesture classification confidence)
  timestamp: number;
}

export type HandState = "idle" | "cocking" | "punching" | "cooldown";

export interface HandDebugInfo {
  state: HandState;
  speed: number;
  vel: Vec3;
  lastGesture: PunchType | "block" | "idle" | "cocking";
  confidence: number;
  blocking: boolean;
  pos: Vec3;
  direction: Vec3;
  stability: number;
  trackingConfidence: number;
}

// ── Tuning constants ────────────────────────────────────────────────────────
/** Below this speed: ignore (natural tremor) */
const NOISE_THRESH    = 0.08;
/** Minimum speed for a direct punch from idle */
const PUNCH_THRESH    = 0.28;
/** Minimum speed to enter cocking state (wind-up) */
const COCK_THRESH     = 0.10;
/** Minimum speed to release a charge attack */
const CHARGE_THRESH   = 0.32;
/** Minimum ms spent cocking before a charge is accepted */
const COCK_MIN_MS     = 180;
/** If still cocking after this many ms with no release → reset */
const COCK_MAX_MS     = 850;
/** How long the PUNCHING state lasts (active frames) */
const PUNCH_WIN_MS    = 220;
/** How long to stay in COOLDOWN before returning to IDLE */
const COOLDOWN_MS     = 620;
/** Wrist y-value above which both hands = blocking (0 = top) */
const BLOCK_Y         = 0.42;
/** Normalised speed that maps to force = 1.0 */
const FORCE_NORM      = 1.4;
/** Primary axis must represent at least this fraction of speed */
const DIR_CONFIDENCE  = 0.52;
/** Minimum classification confidence to emit a punch event */
const EMIT_THRESHOLD  = 0.42;
// ───────────────────────────────────────────────────────────────────────────

interface PerHand {
  smoother: HandSmoother;
  state: HandState;
  stateTs: number;
  lastPunchTs: number;
  debug: HandDebugInfo;
}

export class PunchDetector {
  private hands: { left: PerHand; right: PerHand } = {
    left:  this.makeHand(),
    right: this.makeHand(),
  };
  private blockState    = { left: false, right: false };
  private handsVisible  = { left: false, right: false };
  private callbacks: Array<(e: PunchEvent) => void> = [];

  // ── Public API ─────────────────────────────────────────────────────────────
  onPunch(cb: (e: PunchEvent) => void): void { this.callbacks.push(cb); }

  getBothHandsVisible(): boolean {
    return this.handsVisible.left && this.handsVisible.right;
  }

  isBlocking(): boolean {
    return this.blockState.left && this.blockState.right;
  }

  getDebugInfo(): { left: HandDebugInfo; right: HandDebugInfo } {
    return { left: { ...this.hands.left.debug }, right: { ...this.hands.right.debug } };
  }

  update(
    left:  NormalizedLandmark[] | null,
    right: NormalizedLandmark[] | null,
    confidence: { left: number; right: number; tracking: number } = { left: 0, right: 0, tracking: 0 }
  ): void {
    const now = performance.now();
    this.handsVisible.left  = left  !== null;
    this.handsVisible.right = right !== null;

    if (left)  this.processHand("left",  left,  now, confidence.left);
    else       this.resetHand("left");
    if (right) this.processHand("right", right, now, confidence.right);
    else       this.resetHand("right");

    this.blockState.left  = left  ? left[0].y  < BLOCK_Y : false;
    this.blockState.right = right ? right[0].y < BLOCK_Y : false;

    this.hands.left.debug.blocking  = this.blockState.left;
    this.hands.right.debug.blocking = this.blockState.right;
    this.hands.left.debug.trackingConfidence = confidence.left;
    this.hands.right.debug.trackingConfidence = confidence.right;
  }

  // ── State machine ──────────────────────────────────────────────────────────
  private processHand(
    side: "left" | "right",
    lm: NormalizedLandmark[],
    now: number,
    trackingConfidence: number
  ): void {
    const h = this.hands[side];
    const frame = h.smoother.update(lm, now);
    const stateAge = now - h.stateTs;

    // Update debug
    h.debug.speed = frame.speed;
    h.debug.vel   = frame.vel;
    h.debug.pos   = frame.pos;
    h.debug.direction = this.unit(frame.vel);
    h.debug.stability = Math.max(0, 1 - Math.min(1, frame.speed / 1.8));
    h.debug.trackingConfidence = trackingConfidence;
    h.debug.state = h.state;

    switch (h.state) {
      case "idle":     this.fromIdle(side, h, frame, now, trackingConfidence);         break;
      case "cocking":  this.fromCocking(side, h, frame, stateAge, now); break;
      case "punching": if (stateAge > PUNCH_WIN_MS) this.go(h, "cooldown", now); break;
      case "cooldown": if (stateAge > COOLDOWN_MS)  this.go(h, "idle",     now); break;
    }

    h.debug.state = h.state;
  }

  private fromIdle(
    side: "left" | "right",
    h: PerHand,
    frame: SmoothedFrame,
    now: number,
    trackingConfidence: number
  ): void {
    const { speed, vel } = frame;
    if (speed < NOISE_THRESH) {
      h.debug.lastGesture = "idle";
      return;
    }

    const absVx = Math.abs(vel.x);
    const absVy = Math.abs(vel.y);

    // Slow backward motion → start charging
    if (
      vel.y > COCK_THRESH &&           // moving down (toward waist = wind-up)
      speed < PUNCH_THRESH * 0.9 &&    // not fast enough to be a punch yet
      vel.y > absVx * 0.7              // mostly vertical
    ) {
      this.go(h, "cocking", now);
      h.debug.lastGesture = "cocking";
      h.debug.confidence  = 0;
      return;
    }

    // Fast motion → classify and emit punch
    const adaptivePunchThreshold = PUNCH_THRESH * (trackingConfidence < 0.55 ? 0.9 : 1);
    if (speed >= adaptivePunchThreshold) {
      const { type, confidence } = this.classify(frame);
      const confGate = confidence * trackingConfidence;
      const adaptiveEmitThreshold = EMIT_THRESHOLD * (trackingConfidence < 0.45 ? 0.85 : 1);
      if (confGate >= adaptiveEmitThreshold && now - h.lastPunchTs >= COOLDOWN_MS) {
        this.emit(side, h, type, speed, confidence, now);
      }
    }
  }

  private fromCocking(
    side: "left" | "right",
    h: PerHand,
    frame: SmoothedFrame,
    stateAge: number,
    now: number
  ): void {
    h.debug.lastGesture = "cocking";
    h.debug.confidence  = Math.min(1, stateAge / COCK_MIN_MS);

    // Timeout without release → reset
    if (stateAge > COCK_MAX_MS) {
      this.go(h, "idle", now);
      return;
    }

    // Release: fast forward (Y-negative = upward) after sufficient wind-up
    const { speed, vel } = frame;
    const forwardSpeed = Math.max(0, -vel.y);
    if (
      stateAge >= COCK_MIN_MS &&
      forwardSpeed >= CHARGE_THRESH &&
      speed >= CHARGE_THRESH
    ) {
      const rawForce = Math.min(1, speed / (FORCE_NORM * 0.65));
      // Charge damage multiplied by up to 1.5×
      const force = Math.min(1, rawForce * 1.45);
      this.emitEvent({
        hand: side,
        type: "charge",
        force,
        confidence: 0.92,
        timestamp: now,
      });
      h.lastPunchTs = now;
      h.debug.lastGesture = "charge";
      h.debug.confidence  = 0.92;
      this.go(h, "punching", now);
    }
  }

  /** Classify a fast motion into JAB / HOOK / UPPERCUT */
  private classify(frame: SmoothedFrame): { type: PunchType; confidence: number } {
    const { vel, speed } = frame;
    if (speed < 0.001) return { type: "jab", confidence: 0 };

    const absVx = Math.abs(vel.x);
    const absVy = Math.abs(vel.y);
    const fwdFrac   = Math.max(0, -vel.y) / speed; // Y-neg = forward
    const backFrac  = Math.max(0, vel.y)  / speed; // Y-pos = downward
    const latFrac   = absVx / speed;

    let type: PunchType;
    let dirConf: number;

    if (latFrac > DIR_CONFIDENCE && latFrac >= fwdFrac * 1.1) {
      // Lateral dominant → hook
      type    = "hook";
      dirConf = latFrac;
    } else if (backFrac > DIR_CONFIDENCE && backFrac > fwdFrac && backFrac > latFrac) {
      // Downward dominant → uppercut (fast version of the cocking motion)
      type    = "uppercut";
      dirConf = backFrac;
    } else {
      // Default: upward/forward → jab
      type    = "jab";
      dirConf = Math.max(fwdFrac, 0.5); // jab is the fallback; give generous confidence
    }

    // Speed confidence: how far above the threshold?
    const speedConf = Math.min(1, (speed - PUNCH_THRESH) / PUNCH_THRESH + 0.5);
    // Geometric mean so both axes must be good
    const confidence = Math.sqrt(dirConf * speedConf);
    return { type, confidence };
  }

  private emit(
    side: "left" | "right",
    h: PerHand,
    type: PunchType,
    speed: number,
    confidence: number,
    now: number
  ): void {
    const force = Math.min(1, speed / FORCE_NORM);
    this.emitEvent({ hand: side, type, force, confidence, timestamp: now });
    h.lastPunchTs       = now;
    h.debug.lastGesture = type;
    h.debug.confidence  = confidence;
    this.go(h, "punching", now);
  }

  private emitEvent(event: PunchEvent): void {
    this.callbacks.forEach((cb) => cb(event));
  }

  private go(h: PerHand, state: HandState, now: number): void {
    h.state   = state;
    h.stateTs = now;
  }

  private resetHand(side: "left" | "right"): void {
    const h = this.hands[side];
    h.smoother.reset();
    h.state     = "idle";
    h.stateTs   = 0;
    h.debug.speed = 0;
    h.debug.vel   = { x: 0, y: 0, z: 0 };
    h.debug.pos   = { x: 0, y: 0, z: 0 };
    h.debug.direction = { x: 0, y: 0, z: 0 };
    h.debug.stability = 1;
    h.debug.trackingConfidence = 0;
    h.debug.state = "idle";
    h.debug.lastGesture = "idle";
    h.debug.confidence  = 0;
    h.debug.blocking    = false;
  }

  private makeHand(): PerHand {
    return {
      smoother: new HandSmoother(),
      state:    "idle",
      stateTs:  0,
      lastPunchTs: 0,
      debug: {
        state: "idle",
        speed: 0,
        vel:   { x: 0, y: 0, z: 0 },
        pos:   { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 0 },
        lastGesture: "idle",
        confidence: 0,
        blocking: false,
        stability: 1,
        trackingConfidence: 0,
      },
    };
  }

  private unit(v: Vec3): Vec3 {
    const m = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
    if (m < 1e-6) return { x: 0, y: 0, z: 0 };
    return { x: v.x / m, y: v.y / m, z: v.z / m };
  }
}
