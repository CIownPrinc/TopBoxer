/**
 * Layer 1 — Raw Tracking
 * Applies exponential moving average smoothing and computes
 * per-frame velocity from a sliding time window.
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface Vec3 { x: number; y: number; z: number }

export interface SmoothedFrame {
  pos: Vec3;      // EMA-smoothed wrist position
  vel: Vec3;      // velocity in normalised units / second
  speed: number;  // scalar magnitude of vel
  ts: number;     // performance.now() timestamp
  trail: Vec3[];  // motion trail buffer of last 15 smoothed wrist positions
}

export class HandSmoother {
  private history: Vec3[] = []; // motion trail buffer of last 15 points
  private emaPos: Vec3 | null = null;
  private emaVel: Vec3 | null = null;
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

    // 3. Compute raw velocity: pos delta / dt
    const dt = this.lastTs > 0 ? (ts - this.lastTs) / 1000 : 0.016;
    this.lastTs = ts;

    const rawVel: Vec3 = { x: 0, y: 0, z: 0 };
    if (this.history.length >= 2) {
      const prev = this.history[this.history.length - 2];
      rawVel.x = (pos.x - prev.x) / (dt || 0.001);
      rawVel.y = (pos.y - prev.y) / (dt || 0.001);
      rawVel.z = (pos.z - prev.z) / (dt || 0.001);
    }

    // 4. Velocity EMA smoothing: smoothed = old * 0.8 + new * 0.2
    if (!this.emaVel) {
      this.emaVel = { ...rawVel };
    } else {
      const a = 0.2;
      this.emaVel.x = this.emaVel.x * (1 - a) + rawVel.x * a;
      this.emaVel.y = this.emaVel.y * (1 - a) + rawVel.y * a;
      this.emaVel.z = this.emaVel.z * (1 - a) + rawVel.z * a;
    }
    const vel = { ...this.emaVel };
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

    return { pos, vel, speed, ts, trail: [...this.history] };
  }

  reset(): void {
    this.history = [];
    this.emaPos = null;
    this.emaVel = null;
    this.lastTs = 0;
  }
}
