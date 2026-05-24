/**
 * Layer 1 — Raw Tracking
 * Applies exponential moving average smoothing and computes
 * per-frame velocity and acceleration.
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface Vec3 { x: number; y: number; z: number }

export interface SmoothedFrame {
  pos: Vec3;
  vel: Vec3;
  acc: Vec3;
  speed: number;
  ts: number;
  trail: Vec3[];
}

export class HandSmoother {
  private history: Vec3[] = [];
  private emaPos: Vec3 | null = null;
  private emaVel: Vec3 | null = null;
  private emaAcc: Vec3 | null = null;
  private lastTs = 0;

  update(lm: NormalizedLandmark[], ts: number): SmoothedFrame {
    const wrist = lm[0];
    const rawPos: Vec3 = { x: wrist.x, y: wrist.y, z: wrist.z ?? 0 };

    // 1. Position EMA smoothing: smoothed = old * 0.8 + new * 0.2
    if (!this.emaPos) {
      this.emaPos = { ...rawPos };
    } else {
      const a = 0.2;
      this.emaPos.x = this.emaPos.x * (1 - a) + rawPos.x * a;
      this.emaPos.y = this.emaPos.y * (1 - a) + rawPos.y * a;
      this.emaPos.z = this.emaPos.z * (1 - a) + rawPos.z * a;
    }
    const pos = { ...this.emaPos };

    // 2. Add to motion trail history (max 15 frames)
    this.history.push({ ...pos });
    if (this.history.length > 15) {
      this.history.shift();
    }

    // 3. Compute raw velocity and acceleration: pos delta / dt
    const dt = this.lastTs > 0 ? (ts - this.lastTs) / 1000 : 0.016;
    this.lastTs = ts;

    const rawVel: Vec3 = { x: 0, y: 0, z: 0 };
    const rawAcc: Vec3 = { x: 0, y: 0, z: 0 };

    if (this.history.length >= 2) {
      const prev = this.history[this.history.length - 2];
      rawVel.x = (pos.x - prev.x) / (dt || 0.001);
      rawVel.y = (pos.y - prev.y) / (dt || 0.001);
      rawVel.z = (pos.z - prev.z) / (dt || 0.001);
    }

    // 4. Velocity EMA smoothing: smoothed = old * 0.8 + new * 0.2
    let prevVel = { x: 0, y: 0, z: 0 };
    if (!this.emaVel) {
      this.emaVel = { ...rawVel };
    } else {
      prevVel = { ...this.emaVel };
      const a = 0.2;
      this.emaVel.x = this.emaVel.x * (1 - a) + rawVel.x * a;
      this.emaVel.y = this.emaVel.y * (1 - a) + rawVel.y * a;
      this.emaVel.z = this.emaVel.z * (1 - a) + rawVel.z * a;
    }
    const vel = { ...this.emaVel };
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

    // 5. Compute acceleration: vel delta / dt
    if (this.emaVel) {
      rawAcc.x = (vel.x - prevVel.x) / (dt || 0.001);
      rawAcc.y = (vel.y - prevVel.y) / (dt || 0.001);
      rawAcc.z = (vel.z - prevVel.z) / (dt || 0.001);
    }

    // 6. Acceleration EMA smoothing: smoothed = old * 0.8 + new * 0.2
    if (!this.emaAcc) {
      this.emaAcc = { ...rawAcc };
    } else {
      const a = 0.2;
      this.emaAcc.x = this.emaAcc.x * (1 - a) + rawAcc.x * a;
      this.emaAcc.y = this.emaAcc.y * (1 - a) + rawAcc.y * a;
      this.emaAcc.z = this.emaAcc.z * (1 - a) + rawAcc.z * a;
    }
    const acc = { ...this.emaAcc };

    return { pos, vel, acc, speed, ts, trail: [...this.history] };
  }

  reset(): void {
    this.history = [];
    this.emaPos = null;
    this.emaVel = null;
    this.emaAcc = null;
    this.lastTs = 0;
  }
}
