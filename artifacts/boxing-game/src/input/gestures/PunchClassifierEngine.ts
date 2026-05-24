import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandSide, Vec3, GestureCandidate, HandMotionSample } from "../types";
import type { HandState, PunchType } from "../../game/PunchDetector";

export type PunchPhase = "idle" | "chamber" | "extension" | "impact" | "recovery";

export interface PunchClassifierEngineConfig {
  noiseThresholdSpeed: number;
  minChamberSpeed: number;
  minExtensionSpeed: number;
  impactDecelerationTrigger: number;
  minExtensionRatioToImpact: number;
  maxExtensionDurationMs: number;
  maxChamberDurationMs: number;
  cooldownDurationMs: number;
  recoveryExitSpeed: number;
}

export const defaultEngineConfig: PunchClassifierEngineConfig = {
  noiseThresholdSpeed: 0.08,
  minChamberSpeed: 0.12,
  minExtensionSpeed: 0.28,
  impactDecelerationTrigger: 3.5,
  minExtensionRatioToImpact: 0.15,
  maxExtensionDurationMs: 350,
  maxChamberDurationMs: 650,
  cooldownDurationMs: 400,
  recoveryExitSpeed: 0.15,
};

export const VecMath = {
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),
  clone: (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z }),
  mag: (v: Vec3): number => Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2),
  dist: (a: Vec3, b: Vec3): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s }),
  normalize: (v: Vec3): Vec3 => {
    const m = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
    return m < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: v.x / m, y: v.y / m, z: v.z / m };
  }
};

export interface EngineTelemetry {
  phase: PunchPhase;
  phaseDurationMs: number;
  lastPunchType: PunchType | null;
  lastPunchForce: number;
  lastPunchConfidence: number;
  accelerationMag: number;
  decelerationAlongMotion: number;
  fistConfidence: number;
}

export class PunchClassifierEngine {
  private phase: PunchPhase = "idle";
  private phaseStartMs = 0;
  private lastPunchMs = 0;
  private peakSpeed = 0;
  private peakExtension = 0;
  private fistConfidence = 0.5;
  
  private extensionVelocitySum: Vec3 = VecMath.zero();
  private extensionSampleCount = 0;

  private lastPunchType: PunchType | null = null;
  private lastPunchForce = 0;
  private lastPunchConfidence = 0;

  constructor(
    private readonly side: HandSide,
    private readonly config: PunchClassifierEngineConfig = defaultEngineConfig
  ) {}

  reset(): void {
    this.phase = "idle";
    this.phaseStartMs = 0;
    this.peakSpeed = 0;
    this.peakExtension = 0;
    this.fistConfidence = 0.5;
    this.extensionVelocitySum = VecMath.zero();
    this.extensionSampleCount = 0;
  }

  getTelemetry(currentSample: HandMotionSample): EngineTelemetry {
    const vUnit = VecMath.normalize(currentSample.velocity);
    const decel = -VecMath.dot(currentSample.acceleration, vUnit);
    return {
      phase: this.phase,
      phaseDurationMs: this.phaseStartMs > 0 ? currentSample.timestampMs - this.phaseStartMs : 0,
      lastPunchType: this.lastPunchType,
      lastPunchForce: this.lastPunchForce,
      lastPunchConfidence: this.lastPunchConfidence,
      accelerationMag: VecMath.mag(currentSample.acceleration),
      decelerationAlongMotion: Math.max(0, decel),
      fistConfidence: this.fistConfidence,
    };
  }

  update(hand: HandMotionSample, nowMs: number): GestureCandidate | null {
    const speed = hand.speed;
    const acceleration = hand.acceleration;
    const velocity = hand.velocity;
    const stateAgeMs = this.phaseStartMs > 0 ? nowMs - this.phaseStartMs : 0;
    let candidate: GestureCandidate | null = null;

    // Calculate scale-invariant fistConfidence score from hand structural landmarks
    this.fistConfidence = this.calculateFistConfidence(hand.landmarks);

    const vUnit = VecMath.normalize(velocity);
    const accelerationAlongVelocity = VecMath.dot(acceleration, vUnit);
    const decelerationVal = -accelerationAlongVelocity;

    switch (this.phase) {
      case "idle": {
        const isRetracting = velocity.y > this.config.minChamberSpeed * 0.7 || velocity.z > this.config.minChamberSpeed * 0.7;
        
        if (speed >= this.config.minExtensionSpeed) {
          this.transitionTo("extension", nowMs);
          this.peakSpeed = speed;
          this.peakExtension = hand.extensionRatio;
          this.extensionVelocitySum = VecMath.clone(velocity);
          this.extensionSampleCount = 1;
        } else if (speed >= this.config.minChamberSpeed && isRetracting) {
          this.transitionTo("chamber", nowMs);
        }
        break;
      }

      case "chamber": {
        if (stateAgeMs > this.config.maxChamberDurationMs || speed < this.config.noiseThresholdSpeed) {
          this.transitionTo("idle", nowMs);
          break;
        }

        if (speed >= this.config.minExtensionSpeed) {
          this.transitionTo("extension", nowMs);
          this.peakSpeed = speed;
          this.peakExtension = hand.extensionRatio;
          this.extensionVelocitySum = VecMath.clone(velocity);
          this.extensionSampleCount = 1;
        }
        break;
      }

      case "extension": {
        this.extensionVelocitySum = VecMath.add(this.extensionVelocitySum, velocity);
        this.extensionSampleCount++;

        if (speed > this.peakSpeed) this.peakSpeed = speed;
        if (hand.extensionRatio > this.peakExtension) this.peakExtension = hand.extensionRatio;

        if (stateAgeMs > this.config.maxExtensionDurationMs) {
          this.transitionTo("recovery", nowMs);
          break;
        }

        const isDeceleratingFast = decelerationVal >= this.config.impactDecelerationTrigger;
        const reachedDecentExtension = hand.extensionRatio >= this.config.minExtensionRatioToImpact;
        const isCooldownOver = nowMs - this.lastPunchMs >= this.config.cooldownDurationMs;

        // Punch Intent Gate: Requires high velocity + high deceleration + valid fist confidence
        if (isDeceleratingFast && reachedDecentExtension && isCooldownOver && this.fistConfidence >= 0.50) {
          this.transitionTo("impact", nowMs);
          this.lastPunchMs = nowMs;

          candidate = this.classifyPunch(hand, nowMs);
          if (candidate) {
            this.lastPunchType = candidate.type as PunchType;
            this.lastPunchForce = candidate.strength;
            this.lastPunchConfidence = candidate.confidence;
          }
        }
        break;
      }

      case "impact": {
        this.transitionTo("recovery", nowMs);
        break;
      }

      case "recovery": {
        if (speed < this.config.recoveryExitSpeed || stateAgeMs > 400) {
          this.transitionTo("idle", nowMs);
        }
        break;
      }
    }

    return candidate;
  }

  private calculateFistConfidence(lm: NormalizedLandmark[]): number {
    if (!lm || lm.length < 21) return 0.5; // fallback
    
    const distSq = (a: NormalizedLandmark, b: NormalizedLandmark) => {
      return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    };
    const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.sqrt(distSq(a, b));

    // 1. Finger Spread (index tip [8] to pinky tip [20])
    const knuckleWidth = dist(lm[5], lm[17]);
    const tipSpread = dist(lm[8], lm[20]);
    const spreadRatio = tipSpread / (knuckleWidth || 0.001);
    const spreadScore = Math.max(0, Math.min(1.0, 1.8 - spreadRatio * 0.8));

    // 2. Finger Curl (average distance from tips 8,12,16,20 to palm MCP 9)
    let curlSum = 0;
    const tips = [8, 12, 16, 20];
    tips.forEach(t => {
      curlSum += dist(lm[t], lm[9]);
    });
    const avgCurlDist = curlSum / 4;
    const refLength = dist(lm[0], lm[9]);
    const curlRatio = avgCurlDist / (refLength || 0.001);
    const curlScore = Math.max(0, Math.min(1.0, 1.8 - curlRatio * 1.2));

    // 3. Knuckle Compression (tightness of the knuckles alignment)
    const compressionDist = dist(lm[5], lm[9]) + dist(lm[9], lm[13]) + dist(lm[13], lm[17]);
    const compScore = Math.max(0.3, Math.min(1.0, 1.0 - (compressionDist - refLength * 0.9) / (refLength || 0.001)));

    return (spreadScore * 0.4) + (curlScore * 0.4) + (compScore * 0.2);
  }

  private transitionTo(newPhase: PunchPhase, nowMs: number): void {
    this.phase = newPhase;
    this.phaseStartMs = nowMs;
    if (newPhase === "idle") {
      this.peakSpeed = 0;
      this.peakExtension = 0;
      this.extensionVelocitySum = VecMath.zero();
      this.extensionSampleCount = 0;
    }
  }

  private classifyPunch(hand: HandMotionSample, nowMs: number): GestureCandidate | null {
    if (this.extensionSampleCount === 0) return null;

    const avgVelocity = VecMath.scale(this.extensionVelocitySum, 1 / this.extensionSampleCount);
    const speed = VecMath.mag(avgVelocity);
    if (speed < 0.001) return null;

    const absVx = Math.abs(avgVelocity.x);
    const absVy = Math.abs(avgVelocity.y);
    const absVz = Math.abs(avgVelocity.z);

    const lateralFrac = absVx / speed;
    const verticalFrac = absVy / speed;
    const depthFrac = absVz / speed;

    let type: PunchType = "jab";
    let confidence = 0.55;
    let reason = "default straight strike";

    if (lateralFrac > 0.52 && lateralFrac > verticalFrac) {
      type = "hook";
      confidence = lateralFrac;
      reason = `dominant lateral vector (${Math.round(lateralFrac * 100)}%)`;
    } 
    else if (verticalFrac > 0.48 && avgVelocity.y < 0 && verticalFrac > lateralFrac) {
      type = "uppercut";
      confidence = verticalFrac;
      reason = `dominant vertical rising vector (${Math.round(verticalFrac * 100)}%)`;
    } 
    else {
      const isLead = this.side === "left";
      type = isLead ? "jab" : "cross";
      confidence = Math.max(depthFrac, 0.65);
      reason = `straight forward trajectory (${Math.round(depthFrac * 100)}%)`;
    }

    const force = Math.max(0.2, Math.min(1.0, 0.2 + ((this.peakSpeed - 0.28) / (1.4 - 0.28)) * 0.8));

    return {
      id: `${type}-${this.side}-${nowMs}`,
      type,
      hand: this.side,
      timestampMs: nowMs,
      confidence: Math.round(confidence * 100) / 100,
      strength: Math.round(force * 100) / 100,
      durationMs: nowMs - this.phaseStartMs,
      debugReason: reason,
    };
  }

  getLegacyState(): HandState {
    switch (this.phase) {
      case "idle": return "idle";
      case "chamber": return "cocking";
      case "extension": return "punching";
      case "impact": return "punching";
      case "recovery": return "cooldown";
    }
  }
}
