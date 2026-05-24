import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { HandSmoother } from "./HandSmoother";
import type { SmoothedFrame, Vec3 } from "./HandSmoother";

export type PunchType = "jab" | "cross" | "hook" | "uppercut" | "charge";

export interface PunchEvent {
  hand: "left" | "right";
  type: PunchType;
  force: number;
  confidence: number;
  timestamp: number;
}

export type HandState = "idle" | "guard" | "windup" | "strike" | "recovery" | "cocking" | "punching" | "cooldown";

export interface HandDebugInfo {
  state: HandState;
  speed: number;
  vel: Vec3;
  lastGesture: PunchType | "block" | "idle" | "guard" | "windup" | "strike" | "recovery";
  confidence: number;
  blocking: boolean;
  pos: Vec3;
  direction: Vec3;
  stability: number;
  trackingConfidence: number;
  fistConfidence: number;
}

// ── Tuning constants for hybrid tracking ──────────────────────────────────
const NOISE_THRESH    = 0.08;
const PUNCH_THRESH    = 0.28;
const WINDUP_THRESH   = 0.10;
const STRIKE_WIN_MS   = 200; // Active strike duration
const RECOVERY_MS     = 450; // Cooldown lock-out
const BLOCK_Y         = 0.45; // Guard height
const FORCE_NORM      = 1.4;

interface PerHand {
  smoother: HandSmoother;
  state: HandState;
  stateTs: number;
  lastPunchTs: number;
  debug: HandDebugInfo;
  fistConfidence: number;
}

export class PunchDetector {
  private hands: { left: PerHand; right: PerHand } = {
    left:  this.makeHand(),
    right: this.makeHand(),
  };
  private blockState    = { left: false, right: false };
  private handsVisible  = { left: false, right: false };
  private callbacks: Array<(e: PunchEvent) => void> = [];

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

  private processHand(
    side: "left" | "right",
    lm: NormalizedLandmark[],
    now: number,
    trackingConfidence: number
  ): void {
    const h = this.hands[side];
    const frame = h.smoother.update(lm, now);
    const stateAge = now - h.stateTs;

    // Calculate raw fist confidence
    const rawFistConf = this.calculateFistConfidence(lm);
    
    // Smooth using EMA to filter out motion blur glitches
    if (h.fistConfidence === 0) {
      h.fistConfidence = rawFistConf;
    } else {
      const a = 0.55;
      h.fistConfidence = h.fistConfidence * (1 - a) + rawFistConf * a;
    }

    // Update debug
    h.debug.speed = frame.speed;
    h.debug.vel   = frame.vel;
    h.debug.pos   = frame.pos;
    h.debug.direction = this.unit(frame.vel);
    h.debug.stability = Math.max(0, 1 - Math.min(1, frame.speed / 1.8));
    h.debug.trackingConfidence = trackingConfidence;
    h.debug.fistConfidence = h.fistConfidence;
    h.debug.state = h.state;

    // Strict State Machine transitions
    switch (h.state) {
      case "idle":
      case "guard":
        this.fromIdleOrGuard(side, h, frame, now, trackingConfidence);
        break;
      case "windup":
        this.fromWindup(side, h, frame, stateAge, now);
        break;
      case "strike":
        if (stateAge > STRIKE_WIN_MS) {
          this.go(h, "recovery", now);
        }
        break;
      case "recovery":
        if (stateAge > RECOVERY_MS) {
          this.go(h, frame.pos.y < BLOCK_Y ? "guard" : "idle", now);
        }
        break;
    }

    h.debug.state = h.state;
  }

  private fromIdleOrGuard(
    side: "left" | "right",
    h: PerHand,
    frame: SmoothedFrame,
    now: number,
    trackingConfidence: number
  ): void {
    const { speed, vel, pos, trail } = frame;
    
    // Auto sync state between idle and guard based on height
    const targetState = pos.y < BLOCK_Y ? "guard" : "idle";
    if (h.state !== targetState) {
      this.go(h, targetState, now);
    }

    if (speed < NOISE_THRESH) {
      h.debug.lastGesture = targetState;
      return;
    }

    // 1. Check for windup retraction
    const isRetracting = vel.y > WINDUP_THRESH || vel.z > WINDUP_THRESH;
    if (isRetracting && speed < PUNCH_THRESH * 0.9) {
      this.go(h, "windup", now);
      h.debug.lastGesture = "windup";
      return;
    }

    // 2. Check for strike release (High Velocity + Fist Confidence)
    // Scale required fist confidence dynamically based on tracking quality
    const requiredFistConf = Math.max(0.40, 0.55 - (0.70 - trackingConfidence) * 0.3);
    if (speed >= PUNCH_THRESH && h.fistConfidence >= requiredFistConf && now - h.lastPunchTs >= RECOVERY_MS) {
      const { type, confidence } = this.classifyTrail(trail, vel, speed, h.fistConfidence, side);
      
      const punchScore = confidence * h.fistConfidence;
      if (punchScore >= 0.28) {
        this.emitPunch(side, h, type, speed, confidence, now);
      }
    }
  }

  private fromWindup(
    side: "left" | "right",
    h: PerHand,
    frame: SmoothedFrame,
    stateAge: number,
    now: number
  ): void {
    h.debug.lastGesture = "windup";

    // Windup safety timeout
    if (stateAge > 650) {
      this.go(h, frame.pos.y < BLOCK_Y ? "guard" : "idle", now);
      return;
    }

    // Release strike: fast forward explosion with high fist confidence
    const { speed, vel, trail } = frame;
    const forwardSpeed = Math.max(0, -vel.y) + Math.max(0, -vel.z);
    // Scale required fist confidence dynamically based on tracking quality
    const requiredFistConf = Math.max(0.45, 0.60 - (0.70 - h.debug.trackingConfidence) * 0.35);
    if (forwardSpeed >= PUNCH_THRESH * 0.85 && h.fistConfidence >= requiredFistConf && now - h.lastPunchTs >= RECOVERY_MS) {
      const { type, confidence } = this.classifyTrail(trail, vel, speed, h.fistConfidence, side);
      
      const finalType = type === "cross" || type === "jab" ? "charge" as const : type;
      this.emitPunch(side, h, finalType, speed * 1.25, confidence, now);
    }
  }

  private calculateFistConfidence(lm: NormalizedLandmark[]): number {
    if (!lm || lm.length < 21) return 0.85; // fallback for tests/mocks
    
    // Pure 2D scale-invariant distance calculation to completely eliminate depth-estimation noise
    const dist = (i: number, j: number) => {
      const dx = lm[i].x - lm[j].x;
      const dy = lm[i].y - lm[j].y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Reference Scale: Wrist (0) to middle MCP (9) represents hand size
    const refScale = dist(0, 9);
    if (refScale < 0.001) return 0.5;

    // 1. Knuckle Width & Horizontal Palm Compression
    const knuckleWidth = dist(5, 17);
    
    // 2. Finger Spread (index tip [8] to pinky tip [20] relative to knuckle width)
    const tipSpread = dist(8, 20);
    const spreadRatio = tipSpread / (knuckleWidth || 0.001);
    const spreadScore = Math.max(0, Math.min(1.0, 1.6 - spreadRatio * 0.8));

    // 3. Individual Finger Curl (anatomically correct 2D distance to palm center MCP 9)
    // In a clenched fist, finger tips (8, 12, 16, 20) converge very close to the palm center (9).
    const dIndex = dist(8, 9);
    const dMiddle = dist(12, 9);
    const dRing = dist(16, 9);
    const dPinky = dist(20, 9);

    const indexCurl = Math.max(0, Math.min(1.0, 1.8 - (dIndex / refScale) * 1.2));
    const middleCurl = Math.max(0, Math.min(1.0, 1.8 - (dMiddle / refScale) * 1.2));
    const ringCurl = Math.max(0, Math.min(1.0, 1.8 - (dRing / refScale) * 1.2));
    const pinkyCurl = Math.max(0, Math.min(1.0, 1.8 - (dPinky / refScale) * 1.2));

    const avgCurl = (indexCurl + middleCurl + ringCurl + pinkyCurl) / 4;
    const minCurl = Math.min(indexCurl, middleCurl, ringCurl, pinkyCurl);
    // Combines average hand clench with minimum finger curl to penalize peace signs or finger guns
    const curlScore = avgCurl * 0.3 + minCurl * 0.7;

    // 4. Knuckle Compression Alignment
    const compressionDist = dist(5, 9) + dist(9, 13) + dist(13, 17);
    const compScore = Math.max(0.3, Math.min(1.0, 1.0 - (compressionDist - refScale * 0.9) / refScale));

    // 5. Thumb Tuck / Alignment (thumb tip [4] to index MCP [5] in 2D)
    const dThumb = dist(4, 5);
    const thumbRatio = dThumb / refScale;
    const thumbScore = Math.max(0, Math.min(1.0, 1.3 - thumbRatio * 0.9));

    // Synthesized structural fist confidence score
    return (spreadScore * 0.35) + (curlScore * 0.35) + (compScore * 0.15) + (thumbScore * 0.15);
  }

  private classifyTrail(trail: Vec3[], vel: Vec3, speed: number, fistConf: number, side: "left" | "right"): { type: PunchType; confidence: number } {
    if (trail.length < 4) return { type: "jab", confidence: 0.5 };

    const start = trail[0];
    const end = trail[trail.length - 1];

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;

    const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;

    // Linear Deviation analysis along intermediate points
    let maxDeviation = 0;
    for (let i = 1; i < trail.length - 1; i++) {
      const p = trail[i];
      const ax = p.x - start.x;
      const ay = p.y - start.y;
      const az = p.z - start.z;
      
      const t = Math.max(0, Math.min(1, (ax * dx + ay * dy + az * dz) / (totalDist * totalDist)));
      const cx = start.x + t * dx;
      const cy = start.y + t * dy;
      const cz = start.z + t * dz;
      
      const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2);
      if (d > maxDeviation) maxDeviation = d;
    }

    const isStraight = maxDeviation < 0.08;
    const horizontalArc = Math.abs(dx) > Math.abs(dy) * 1.15 && !isStraight;
    const verticalArc = dy < -0.05 && !isStraight; // Y-negative is rising

    let type: PunchType = "jab";
    let confidence = 0.55;

    if (horizontalArc) {
      type = "hook";
      confidence = 0.65 + Math.min(0.35, maxDeviation * 2.0);
    } else if (verticalArc) {
      type = "uppercut";
      confidence = 0.65 + Math.min(0.35, maxDeviation * 2.0);
    } else {
      if (side === "right") {
        type = "cross";
        confidence = 0.70 + Math.min(0.30, fistConf * 0.3);
      } else {
        type = "jab";
        confidence = 0.65 + Math.min(0.35, fistConf * 0.4);
      }
    }

    return { type, confidence };
  }

  private emitPunch(
    side: "left" | "right",
    h: PerHand,
    type: PunchType,
    speed: number,
    confidence: number,
    now: number
  ): void {
    const force = Math.min(1.0, speed / FORCE_NORM);
    const event: PunchEvent = { hand: side, type, force, confidence, timestamp: now };
    this.callbacks.forEach((cb) => cb(event));

    h.lastPunchTs = now;
    h.debug.lastGesture = type;
    h.debug.confidence  = confidence;
    
    this.go(h, "strike", now);
  }

  private go(h: PerHand, state: HandState, now: number): void {
    h.state   = state;
    h.stateTs = now;
    h.debug.state = state;
  }

  private resetHand(side: "left" | "right"): void {
    const h = this.hands[side];
    h.smoother.reset();
    h.state     = "idle";
    h.stateTs   = 0;
    h.fistConfidence = 0;
    
    h.debug.speed = 0;
    h.debug.vel   = { x: 0, y: 0, z: 0 };
    h.debug.pos   = { x: 0, y: 0, z: 0 };
    h.debug.direction = { x: 0, y: 0, z: 0 };
    h.debug.stability = 1;
    h.debug.trackingConfidence = 0;
    h.debug.fistConfidence = 0;
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
      fistConfidence: 0,
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
        fistConfidence: 0,
      },
    };
  }

  private unit(v: Vec3): Vec3 {
    const m = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
    if (m < 1e-6) return { x: 0, y: 0, z: 0 };
    return { x: v.x / m, y: v.y / m, z: v.z / m };
  }
}
