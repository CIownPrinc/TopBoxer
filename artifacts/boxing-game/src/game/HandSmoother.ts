/**
 * Layer 1 — Raw Tracking
 * Applies exponential moving average smoothing and computes
 * per-frame velocity from a sliding time window.
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Higher alpha = more responsive, less smoothing (0–1)
const EMA_ALPHA = 0.38;
// Look-back window used for velocity computation (ms)
const VEL_WINDOW_MS = 110;

export interface Vec3 { x: number; y: number; z: number }

export interface SmoothedFrame {
  pos: Vec3;      // EMA-smoothed wrist position
  vel: Vec3;      // velocity in normalised units / second
  speed: number;  // scalar magnitude of vel
  ts: number;     // performance.now() timestamp
}

interface StoredFrame { pos: Vec3; ts: number }

export class HandSmoother {
  private history: StoredFrame[] = [];
  private ema: Vec3 | null = null;

  update(lm: NormalizedLandmark[], ts: number): SmoothedFrame {
    const wrist = lm[0];
    const raw: Vec3 = { x: wrist.x, y: wrist.y, z: wrist.z ?? 0 };

    // Initialise or apply EMA
    if (!this.ema) {
      this.ema = { ...raw };
    } else {
      const a = EMA_ALPHA;
      this.ema.x = a * raw.x + (1 - a) * this.ema.x;
      this.ema.y = a * raw.y + (1 - a) * this.ema.y;
      this.ema.z = a * raw.z + (1 - a) * this.ema.z;
    }

    const pos: Vec3 = { ...this.ema };
    this.history.push({ pos, ts });

    // Discard frames outside the velocity window
    const cutoff = ts - VEL_WINDOW_MS;
    while (this.history.length > 1 && this.history[0].ts < cutoff) {
      this.history.shift();
    }

    const vel = this.computeVelocity();
    const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
    return { pos, vel, speed, ts };
  }

  private computeVelocity(): Vec3 {
    if (this.history.length < 2) return { x: 0, y: 0, z: 0 };
    const a = this.history[0];
    const b = this.history[this.history.length - 1];
    const dt = (b.ts - a.ts) / 1000; // → seconds
    if (dt <= 0) return { x: 0, y: 0, z: 0 };
    return {
      x: (b.pos.x - a.pos.x) / dt,
      y: (b.pos.y - a.pos.y) / dt,
      z: (b.pos.z - a.pos.z) / dt,
    };
  }

  reset(): void {
    this.history = [];
    this.ema = null;
  }
}
