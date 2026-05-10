import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type PunchType = "jab" | "hook" | "uppercut";

export interface PunchEvent {
  hand: "left" | "right";
  type: PunchType;
  force: number; // 0–1
  timestamp: number;
}

interface FrameData {
  wrist: { x: number; y: number };
  ts: number;
}

// ─── Tuning constants ────────────────────────────────────────────────────────
const HISTORY_SIZE = 10;
const PUNCH_COOLDOWN_MS = 700;   // ms between punches per hand
// scaledSpeed = (Δpos / Δt_ms) * 1000  → units/sec
// Natural tremor ≈ 0.05–0.15 u/s; real punch ≈ 0.4–2.0 u/s
const VELOCITY_THRESHOLD = 0.28;  // require clear intentional motion
const MIN_TRAVEL = 0.04;          // wrist must travel ≥4 % of frame width
const FORCE_NORM = 1.5;           // scaledSpeed at which force = 1.0
// Block: both wrists above this y in normalised coords (0 = top)
const BLOCK_Y = 0.42;
// ─────────────────────────────────────────────────────────────────────────────

export class PunchDetector {
  private leftHist: FrameData[] = [];
  private rightHist: FrameData[] = [];
  private lastPunchL = 0;
  private lastPunchR = 0;
  private blockState = { left: false, right: false };
  private handsVisible = { left: false, right: false };
  private callbacks: Array<(e: PunchEvent) => void> = [];

  onPunch(cb: (e: PunchEvent) => void): void {
    this.callbacks.push(cb);
  }

  /** Returns true when both hands have been seen this frame */
  getBothHandsVisible(): boolean {
    return this.handsVisible.left && this.handsVisible.right;
  }

  isBlocking(): boolean {
    return this.blockState.left && this.blockState.right;
  }

  update(
    left: NormalizedLandmark[] | null,
    right: NormalizedLandmark[] | null
  ): void {
    const now = performance.now();
    this.handsVisible.left = left !== null;
    this.handsVisible.right = right !== null;

    if (left) this.processHand("left", left, now);
    if (right) this.processHand("right", right, now);

    // Block: wrist above face level on both hands
    this.blockState.left = left ? left[0].y < BLOCK_Y : false;
    this.blockState.right = right ? right[0].y < BLOCK_Y : false;
  }

  private processHand(
    hand: "left" | "right",
    lm: NormalizedLandmark[],
    now: number
  ): void {
    const hist = hand === "left" ? this.leftHist : this.rightHist;
    hist.push({ wrist: { x: lm[0].x, y: lm[0].y }, ts: now });
    if (hist.length > HISTORY_SIZE) hist.shift();
    if (hist.length < 4) return;

    const cooldownTs = hand === "left" ? this.lastPunchL : this.lastPunchR;
    if (now - cooldownTs < PUNCH_COOLDOWN_MS) return;

    this.tryDetect(hand, hist, now);
  }

  private tryDetect(
    hand: "left" | "right",
    hist: FrameData[],
    now: number
  ): void {
    // Use the most recent 5 frames for velocity computation
    const window = hist.slice(-5);
    const oldest = window[0];
    const newest = window[window.length - 1];
    const dt = newest.ts - oldest.ts;
    if (dt <= 0) return;

    const rawDx = newest.wrist.x - oldest.wrist.x;
    const rawDy = newest.wrist.y - oldest.wrist.y;
    const travel = Math.sqrt(rawDx * rawDx + rawDy * rawDy);

    // Gate 1: minimum real-world travel distance
    if (travel < MIN_TRAVEL) return;

    const vx = rawDx / dt;
    const vy = rawDy / dt;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const scaledSpeed = speed * 1000; // convert to units/sec

    // Gate 2: minimum velocity
    if (scaledSpeed < VELOCITY_THRESHOLD) return;

    // Classify punch by dominant axis
    const absVx = Math.abs(vx);
    const absVy = Math.abs(vy);
    let type: PunchType;
    if (absVy > absVx * 1.4 && vy < 0) {
      type = "jab";       // upward → forward
    } else if (absVy > absVx * 1.4 && vy > 0) {
      type = "uppercut";  // downward (scooping up)
    } else {
      type = "hook";      // horizontal sweep
    }

    const force = Math.min(1, scaledSpeed / FORCE_NORM);

    if (hand === "left") this.lastPunchL = now;
    else this.lastPunchR = now;

    this.callbacks.forEach((cb) =>
      cb({ hand, type, force, timestamp: now })
    );
  }
}
