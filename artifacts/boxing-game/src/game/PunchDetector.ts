import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type PunchType = "jab" | "hook" | "uppercut" | "block";

export interface PunchEvent {
  hand: "left" | "right";
  type: PunchType;
  force: number; // 0-1
  timestamp: number;
}

interface FrameData {
  wrist: { x: number; y: number };
  indexTip: { x: number; y: number };
  ts: number;
}

const HISTORY_SIZE = 8;
const PUNCH_COOLDOWN_MS = 400;
const VELOCITY_THRESHOLD = 0.018; // normalized units per ms * 10
const BLOCK_Y_THRESHOLD = 0.4; // wrist above this y (0=top) = blocking

export class PunchDetector {
  private leftHistory: FrameData[] = [];
  private rightHistory: FrameData[] = [];
  private lastPunchLeft = 0;
  private lastPunchRight = 0;
  private callbacks: Array<(e: PunchEvent) => void> = [];
  private blockState = { left: false, right: false };

  onPunch(cb: (e: PunchEvent) => void): void {
    this.callbacks.push(cb);
  }

  getBlockState(): { left: boolean; right: boolean } {
    return { ...this.blockState };
  }

  update(
    left: NormalizedLandmark[] | null,
    right: NormalizedLandmark[] | null
  ): void {
    const now = performance.now();
    if (left) this.updateHand("left", left, now);
    if (right) this.updateHand("right", right, now);

    // Update block state
    this.blockState.left = left ? left[0].y < BLOCK_Y_THRESHOLD : false;
    this.blockState.right = right ? right[0].y < BLOCK_Y_THRESHOLD : false;
  }

  private updateHand(
    hand: "left" | "right",
    landmarks: NormalizedLandmark[],
    now: number
  ): void {
    const wrist = landmarks[0];
    const indexTip = landmarks[8];
    const frame: FrameData = {
      wrist: { x: wrist.x, y: wrist.y },
      indexTip: { x: indexTip.x, y: indexTip.y },
      ts: now,
    };

    const history = hand === "left" ? this.leftHistory : this.rightHistory;
    history.push(frame);
    if (history.length > HISTORY_SIZE) history.shift();

    if (history.length < 3) return;

    const cooldown =
      hand === "left" ? this.lastPunchLeft : this.lastPunchRight;
    if (now - cooldown < PUNCH_COOLDOWN_MS) return;

    this.detectPunch(hand, history, now);
  }

  private detectPunch(
    hand: "left" | "right",
    history: FrameData[],
    now: number
  ): void {
    if (history.length < 3) return;

    const recent = history.slice(-4);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];
    const dt = newest.ts - oldest.ts;
    if (dt <= 0) return;

    const dx = (newest.wrist.x - oldest.wrist.x) / dt;
    const dy = (newest.wrist.y - oldest.wrist.y) / dt;
    const speed = Math.sqrt(dx * dx + dy * dy);
    const scaledSpeed = speed * 1000; // per second

    if (scaledSpeed < VELOCITY_THRESHOLD) return;

    // Determine punch type from direction
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    let type: PunchType;

    if (absDy > absDx * 1.5 && dy < 0) {
      type = "jab"; // upward = forward punch
    } else if (absDy > absDx * 1.5 && dy > 0) {
      type = "uppercut";
    } else if (absDx > absDy) {
      type = "hook"; // horizontal sweep
    } else {
      type = "jab";
    }

    const force = Math.min(1, scaledSpeed / 0.12);

    const event: PunchEvent = { hand, type, force, timestamp: now };
    if (hand === "left") this.lastPunchLeft = now;
    else this.lastPunchRight = now;

    this.callbacks.forEach((cb) => cb(event));
  }

  isBlocking(): boolean {
    return this.blockState.left && this.blockState.right;
  }
}
