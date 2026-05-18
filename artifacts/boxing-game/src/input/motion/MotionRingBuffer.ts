import type { Vec3 } from "../types";

interface Sample { position: Vec3; timestampMs: number }

export class MotionRingBuffer {
  private samples: Sample[] = [];

  constructor(private readonly windowMs: number) {}

  reset(): void { this.samples = []; }

  push(position: Vec3, timestampMs: number): void {
    this.samples.push({ position: { ...position }, timestampMs });
    const cutoff = timestampMs - this.windowMs;
    while (this.samples.length > 1 && this.samples[0].timestampMs < cutoff) this.samples.shift();
  }

  velocity(): Vec3 {
    if (this.samples.length < 2) return { x: 0, y: 0, z: 0 };
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = (b.timestampMs - a.timestampMs) / 1000;
    if (dt <= 0) return { x: 0, y: 0, z: 0 };
    return { x: (b.position.x - a.position.x) / dt, y: (b.position.y - a.position.y) / dt, z: (b.position.z - a.position.z) / dt };
  }

  travel(): number {
    if (this.samples.length < 2) return 0;
    const a = this.samples[0].position;
    const b = this.samples[this.samples.length - 1].position;
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
  }
}
