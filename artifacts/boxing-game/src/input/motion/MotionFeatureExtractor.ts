import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { AlphaBetaVec3Filter } from "../smoothing/AlphaBetaFilter";
import { MotionRingBuffer } from "./MotionRingBuffer";
import { OneEuroVec3Filter } from "../smoothing/OneEuroFilter";
import type { HandMotionSample, HandQuality, HandSide, InputCalibration, MotionFrame, RawHandFrame, Vec3 } from "../types";
import type { InputSystemConfig } from "../tuning/defaultInputConfig";

function wrist(lm: NormalizedLandmark[]): Vec3 { return { x: lm[0].x, y: lm[0].y, z: lm[0].z ?? 0 }; }
function dist(a: Vec3, b: Vec3): number { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2); }
function unit(v: Vec3): Vec3 { const m = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2); return m < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: v.x / m, y: v.y / m, z: v.z / m }; }
function ratios(v: Vec3): { lateral: number; vertical: number; forward: number } { const m = Math.max(1e-6, Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2)); return { lateral: Math.abs(v.x) / m, vertical: Math.abs(v.y) / m, forward: Math.abs(v.z) / m }; }

interface PerHandFilters {
  oneEuro: OneEuroVec3Filter;
  alphaBeta: AlphaBetaVec3Filter;
  buffer: MotionRingBuffer;
  lastVelocity: Vec3;
  lastTs: number;
  dropped: number;
}

export class MotionFeatureExtractor {
  private filters: Record<HandSide, PerHandFilters>;

  constructor(private readonly config: InputSystemConfig) {
    this.filters = {
      left: this.makeFilters(),
      right: this.makeFilters(),
    };
  }

  reset(): void {
    this.filters.left = this.makeFilters();
    this.filters.right = this.makeFilters();
  }

  extract(raw: RawHandFrame, calibration: InputCalibration): MotionFrame {
    const hands: MotionFrame["hands"] = {};
    const left = raw.left ? this.extractHand("left", raw.left, raw.leftConfidence, raw.timestampMs, calibration) : null;
    const right = raw.right ? this.extractHand("right", raw.right, raw.rightConfidence, raw.timestampMs, calibration) : null;
    if (left) hands.left = left; else this.filters.left.dropped++;
    if (right) hands.right = right; else this.filters.right.dropped++;

    const lpos = left?.smoothedPosition ?? calibration.guard.leftGuard;
    const rpos = right?.smoothedPosition ?? calibration.guard.rightGuard;
    const center = { x: (lpos.x + rpos.x) / 2, y: (lpos.y + rpos.y) / 2, z: (lpos.z + rpos.z) / 2 };
    return {
      frameId: raw.frameId,
      timestampMs: raw.timestampMs,
      hands,
      body: {
        timestampMs: raw.timestampMs,
        center,
        headProxy: { x: center.x, y: center.y - 0.12, z: center.z },
        guardClusterCenter: center,
        lateralOffsetFromCenter: center.x - calibration.body.centerLineX,
        verticalOffsetFromBaseline: center.y - calibration.guard.guardCenter.y,
        leanVelocity: { x: 0, y: 0, z: 0 },
        quality: raw.trackingConfidence,
      },
      calibration,
      trackingConfidence: raw.trackingConfidence,
    };
  }

  private extractHand(side: HandSide, landmarks: NormalizedLandmark[], confidence: number, timestampMs: number, calibration: InputCalibration): HandMotionSample {
    const f = this.filters[side];
    const rawPosition = wrist(landmarks);
    const smoothedPosition = f.oneEuro.update(rawPosition, timestampMs);
    const filtered = f.alphaBeta.update(smoothedPosition, timestampMs);
    f.buffer.push(filtered.position, timestampMs);
    const velocity = f.buffer.velocity();
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
    const dt = f.lastTs > 0 ? Math.max(0.001, (timestampMs - f.lastTs) / 1000) : 1 / 30;
    const acceleration = { x: (velocity.x - f.lastVelocity.x) / dt, y: (velocity.y - f.lastVelocity.y) / dt, z: (velocity.z - f.lastVelocity.z) / dt };
    f.lastVelocity = velocity;
    f.lastTs = timestampMs;

    const guard = side === "left" ? calibration.guard.leftGuard : calibration.guard.rightGuard;
    const distanceFromGuard = dist(filtered.position, guard);
    const reach = side === "left" ? calibration.reach.leftReach : calibration.reach.rightReach;
    const r = ratios(velocity);
    const quality: HandQuality = {
      visible: true,
      confidence,
      stability: Math.max(0, 1 - Math.min(1, speed / 1.8)),
      jitter: Math.min(1, dist(rawPosition, smoothedPosition) * 20),
      droppedFrames: f.dropped,
      status: confidence >= 0.42 ? "valid" : "low-confidence",
    };

    return {
      side,
      timestampMs,
      rawPosition,
      calibratedPosition: rawPosition,
      smoothedPosition: filtered.position,
      predictedPosition: f.alphaBeta.predict(Math.min(this.config.smoothing.maxPredictionMs, confidence > 0.55 ? 34 : 16)),
      velocity,
      smoothedVelocity: velocity,
      acceleration,
      speed,
      direction: unit(velocity),
      distanceFromGuard,
      extensionRatio: Math.min(1, distanceFromGuard / Math.max(0.05, reach)),
      lateralRatio: r.lateral,
      verticalRatio: r.vertical,
      forwardRatio: r.forward,
      quality,
      landmarks,
    };
  }

  private makeFilters(): PerHandFilters {
    return {
      oneEuro: new OneEuroVec3Filter(this.config.smoothing.oneEuro.minCutoff, this.config.smoothing.oneEuro.beta, this.config.smoothing.oneEuro.derivativeCutoff),
      alphaBeta: new AlphaBetaVec3Filter(this.config.smoothing.alphaBeta.alpha, this.config.smoothing.alphaBeta.beta),
      buffer: new MotionRingBuffer(this.config.smoothing.velocityWindowMs),
      lastVelocity: { x: 0, y: 0, z: 0 },
      lastTs: 0,
      dropped: 0,
    };
  }
}
