import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandSide, InputCalibration, Vec3 } from "../types";

function wrist(lm: NormalizedLandmark[] | null): Vec3 | null {
  if (!lm?.[0]) return null;
  return { x: lm[0].x, y: lm[0].y, z: lm[0].z ?? 0 };
}

function avg(points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0.5, y: 0.45, z: 0 };
  return points.reduce((a, p) => ({ x: a.x + p.x / points.length, y: a.y + p.y / points.length, z: a.z + p.z / points.length }), { x: 0, y: 0, z: 0 });
}

function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export class CalibrationSystem {
  private calibration: InputCalibration | null = null;
  private leftSamples: Vec3[] = [];
  private rightSamples: Vec3[] = [];
  private startedAt = 0;

  start(timestampMs = performance.now()): void {
    this.leftSamples = [];
    this.rightSamples = [];
    this.startedAt = timestampMs;
  }

  update(left: NormalizedLandmark[] | null, right: NormalizedLandmark[] | null, timestampMs: number): InputCalibration {
    const l = wrist(left);
    const r = wrist(right);
    if (l) this.leftSamples.push(l);
    if (r) this.rightSamples.push(r);
    if (this.leftSamples.length > 90) this.leftSamples.shift();
    if (this.rightSamples.length > 90) this.rightSamples.shift();

    if (!this.calibration || (this.leftSamples.length >= 12 && this.rightSamples.length >= 12)) {
      this.calibration = this.build(timestampMs);
    }
    return this.calibration;
  }

  get(): InputCalibration {
    if (!this.calibration) this.calibration = this.build(performance.now());
    return this.calibration;
  }

  set(calibration: InputCalibration): void { this.calibration = calibration; }

  private build(timestampMs: number): InputCalibration {
    const leftGuard = avg(this.leftSamples);
    const rightGuard = avg(this.rightSamples);
    const guardCenter = { x: (leftGuard.x + rightGuard.x) / 2, y: (leftGuard.y + rightGuard.y) / 2, z: (leftGuard.z + rightGuard.z) / 2 };
    const guardRadius = Math.max(0.06, dist(leftGuard, rightGuard) * 0.45);
    const confidence = Math.min(1, Math.min(this.leftSamples.length, this.rightSamples.length) / 24);
    return {
      version: 1,
      stance: "orthodox",
      mirrorMode: true,
      guard: {
        leftGuard,
        rightGuard,
        guardCenter,
        guardRadius,
        upperGuardY: guardCenter.y - 0.08,
        lowerGuardY: guardCenter.y + 0.14,
      },
      body: {
        centerLineX: guardCenter.x,
        headBaselineY: guardCenter.y - 0.12,
        torsoBaselineY: guardCenter.y + 0.20,
        shoulderWidthEstimate: Math.max(0.18, Math.abs(rightGuard.x - leftGuard.x) * 1.35),
        userScale: Math.max(0.18, dist(leftGuard, rightGuard)),
      },
      reach: {
        leftReach: Math.max(0.18, dist(leftGuard, guardCenter) * 2.2),
        rightReach: Math.max(0.18, dist(rightGuard, guardCenter) * 2.2),
        maxForwardExtension: 0.28,
      },
      createdAtMs: this.startedAt || timestampMs,
      confidence,
    };
  }

  guardFor(side: HandSide): Vec3 {
    const c = this.get();
    return side === "left" ? c.guard.leftGuard : c.guard.rightGuard;
  }
}
