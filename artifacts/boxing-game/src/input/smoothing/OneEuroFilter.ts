import type { Vec3 } from "../types";

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / Math.max(0.001, dt));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class OneEuroVec3Filter {
  private value: Vec3 | null = null;
  private derivative: Vec3 = { x: 0, y: 0, z: 0 };
  private lastTs = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly derivativeCutoff: number,
  ) {}

  reset(): void {
    this.value = null;
    this.derivative = { x: 0, y: 0, z: 0 };
    this.lastTs = 0;
  }

  update(next: Vec3, timestampMs: number): Vec3 {
    if (!this.value || this.lastTs === 0) {
      this.value = { ...next };
      this.lastTs = timestampMs;
      return { ...next };
    }

    const dt = Math.max(0.001, (timestampMs - this.lastTs) / 1000);
    this.lastTs = timestampMs;

    const rawDerivative = {
      x: (next.x - this.value.x) / dt,
      y: (next.y - this.value.y) / dt,
      z: (next.z - this.value.z) / dt,
    };
    const da = alpha(this.derivativeCutoff, dt);
    this.derivative = {
      x: lerp(this.derivative.x, rawDerivative.x, da),
      y: lerp(this.derivative.y, rawDerivative.y, da),
      z: lerp(this.derivative.z, rawDerivative.z, da),
    };

    const speed = Math.sqrt(this.derivative.x ** 2 + this.derivative.y ** 2 + this.derivative.z ** 2);
    const a = alpha(this.minCutoff + this.beta * speed, dt);
    this.value = {
      x: lerp(this.value.x, next.x, a),
      y: lerp(this.value.y, next.y, a),
      z: lerp(this.value.z, next.z, a),
    };
    return { ...this.value };
  }
}
