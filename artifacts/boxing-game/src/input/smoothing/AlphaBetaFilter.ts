import type { Vec3 } from "../types";

export class AlphaBetaVec3Filter {
  private position: Vec3 | null = null;
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private lastTs = 0;

  constructor(private readonly alpha: number, private readonly beta: number) {}

  reset(): void {
    this.position = null;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.lastTs = 0;
  }

  update(measured: Vec3, timestampMs: number): { position: Vec3; velocity: Vec3 } {
    if (!this.position || this.lastTs === 0) {
      this.position = { ...measured };
      this.lastTs = timestampMs;
      return { position: { ...this.position }, velocity: { ...this.velocity } };
    }

    const dt = Math.max(0.001, (timestampMs - this.lastTs) / 1000);
    this.lastTs = timestampMs;
    const predicted = {
      x: this.position.x + this.velocity.x * dt,
      y: this.position.y + this.velocity.y * dt,
      z: this.position.z + this.velocity.z * dt,
    };
    const residual = {
      x: measured.x - predicted.x,
      y: measured.y - predicted.y,
      z: measured.z - predicted.z,
    };
    this.position = {
      x: predicted.x + this.alpha * residual.x,
      y: predicted.y + this.alpha * residual.y,
      z: predicted.z + this.alpha * residual.z,
    };
    this.velocity = {
      x: this.velocity.x + (this.beta * residual.x) / dt,
      y: this.velocity.y + (this.beta * residual.y) / dt,
      z: this.velocity.z + (this.beta * residual.z) / dt,
    };
    return { position: { ...this.position }, velocity: { ...this.velocity } };
  }

  predict(horizonMs: number): Vec3 {
    if (!this.position) return { x: 0, y: 0, z: 0 };
    const dt = Math.max(0, horizonMs) / 1000;
    return {
      x: this.position.x + this.velocity.x * dt,
      y: this.position.y + this.velocity.y * dt,
      z: this.position.z + this.velocity.z * dt,
    };
  }
}
