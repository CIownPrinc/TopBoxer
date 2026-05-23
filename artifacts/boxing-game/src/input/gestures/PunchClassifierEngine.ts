import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandSide, Vec3, GestureCandidate, HandMotionSample } from "../types";
import type { HandState, HandDebugInfo, PunchType } from "../../game/PunchDetector";

export type PunchPhase = "idle" | "chamber" | "extension" | "impact" | "recovery";

export interface PunchClassifierEngineConfig {
  /** Speed below which motion is ignored as tremor/noise (units/sec) */
  noiseThresholdSpeed: number;
  /** Velocity magnitude toward cocking direction to enter chamber (units/sec) */
  minChamberSpeed: number;
  /** Velocity magnitude required to enter extension phase (units/sec) */
  minExtensionSpeed: number;
  /** Deceleration magnitude (negative acceleration along velocity direction) to trigger impact (units/sec^2) */
  impactDecelerationTrigger: number;
  /** Minimum extension ratio from guard position to allow impact registration (0-1) */
  minExtensionRatioToImpact: number;
  /** Safety timeout for extension state before automatically falling back to recovery (ms) */
  maxExtensionDurationMs: number;
  /** Safety timeout for chamber state before resetting to idle (ms) */
  maxChamberDurationMs: number;
  /** Cooldown duration after a punch triggers before allowing the next one (ms) */
  cooldownDurationMs: number;
  /** Speed below which recovery terminates and returns to idle (units/sec) */
  recoveryExitSpeed: number;
}

export const defaultEngineConfig: PunchClassifierEngineConfig = {
  noiseThresholdSpeed: 0.08,
  minChamberSpeed: 0.12,
  minExtensionSpeed: 0.28,
  impactDecelerationTrigger: 3.5, // 3.5 units/s^2 deceleration
  minExtensionRatioToImpact: 0.15, // Must be extended at least 15% from guard
  maxExtensionDurationMs: 350,     // Punch extension should complete within 350ms
  maxChamberDurationMs: 650,       // Chamber wind-up safety timeout
  cooldownDurationMs: 400,         // Minimum 400ms between punches
  recoveryExitSpeed: 0.15,
};

// ── Vector Mathematics Utilities ─────────────────────────────────────────────
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
}

export class PunchClassifierEngine {
  private phase: PunchPhase = "idle";
  private phaseStartMs = 0;
  private lastPunchMs = 0;
  private peakSpeed = 0;
  private peakExtension = 0;
  
  // Historical stats for classification
  private extensionVelocitySum: Vec3 = VecMath.zero();
  private extensionSampleCount = 0;

  // Diagnostics / telemetry hooks
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
    };
  }

  /**
   * Stateful classification engine. Processes each HandMotionSample and maps it
   * through the 5 punch phases using vector kinematics.
   */
  update(hand: HandMotionSample, nowMs: number): GestureCandidate | null {
    const speed = hand.speed;
    const acceleration = hand.acceleration;
    const velocity = hand.velocity;
    const stateAgeMs = this.phaseStartMs > 0 ? nowMs - this.phaseStartMs : 0;
    let candidate: GestureCandidate | null = null;

    // We projects a unit vector representing the primary direction of hand movement
    const vUnit = VecMath.normalize(velocity);
    // Acceleration projected along the velocity vector (negative means deceleration)
    const accelerationAlongVelocity = VecMath.dot(acceleration, vUnit);
    const decelerationVal = -accelerationAlongVelocity;

    switch (this.phase) {
      case "idle": {
        // Guard check: is hand moving quickly backwards/downwards (cocking/loading)?
        const isRetracting = velocity.y > this.config.minChamberSpeed * 0.7 || velocity.z > this.config.minChamberSpeed * 0.7;
        
        if (speed >= this.config.minExtensionSpeed) {
          // Direct punch from idle (no chamber wind-up)
          this.transitionTo("extension", nowMs);
          this.peakSpeed = speed;
          this.peakExtension = hand.extensionRatio;
          this.extensionVelocitySum = VecMath.clone(velocity);
          this.extensionSampleCount = 1;
        } else if (speed >= this.config.minChamberSpeed && isRetracting) {
          // Hand loading up for a punch
          this.transitionTo("chamber", nowMs);
        }
        break;
      }

      case "chamber": {
        // If we timeout or hand returns to rest, reset
        if (stateAgeMs > this.config.maxChamberDurationMs || speed < this.config.noiseThresholdSpeed) {
          this.transitionTo("idle", nowMs);
          break;
        }

        // If hand suddenly explodes forward with high velocity
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
        // Accumulate directional vectors to average out noise
        this.extensionVelocitySum = VecMath.add(this.extensionVelocitySum, velocity);
        this.extensionSampleCount++;

        if (speed > this.peakSpeed) this.peakSpeed = speed;
        if (hand.extensionRatio > this.peakExtension) this.peakExtension = hand.extensionRatio;

        // Safety timeout to avoid getting stuck in extension
        if (stateAgeMs > this.config.maxExtensionDurationMs) {
          this.transitionTo("recovery", nowMs);
          break;
        }

        // Check for IMPACT: massive deceleration spike (negative acceleration along velocity)
        // OR reaching peak extension ratio (stopping)
        const isDeceleratingFast = decelerationVal >= this.config.impactDecelerationTrigger;
        const reachedDecentExtension = hand.extensionRatio >= this.config.minExtensionRatioToImpact;
        const isCooldownOver = nowMs - this.lastPunchMs >= this.config.cooldownDurationMs;

        if (isDeceleratingFast && reachedDecentExtension && isCooldownOver) {
          // Trigger impact!
          this.transitionTo("impact", nowMs);
          this.lastPunchMs = nowMs;

          // Classify punch based on cumulative motion metrics in extension phase
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
        // Impact is a single-frame transition phase
        this.transitionTo("recovery", nowMs);
        break;
      }

      case "recovery": {
        // Return phase: hand is moving back toward the guard (velocity vector points backward)
        const isReturning = VecMath.dot(velocity, hand.smoothedPosition) < 0; // rough heuristic of direction
        
        if (speed < this.config.recoveryExitSpeed || stateAgeMs > 400) {
          this.transitionTo("idle", nowMs);
        }
        break;
      }
    }

    return candidate;
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

  /**
   * Classify the specific type of punch based on average directional vectors and spatial parameters.
   */
  private classifyPunch(hand: HandMotionSample, nowMs: number): GestureCandidate | null {
    if (this.extensionSampleCount === 0) return null;

    // Average extension velocity vector
    const avgVelocity = VecMath.scale(this.extensionVelocitySum, 1 / this.extensionSampleCount);
    const speed = VecMath.mag(avgVelocity);
    if (speed < 0.001) return null;

    const absVx = Math.abs(avgVelocity.x);
    const absVy = Math.abs(avgVelocity.y);
    const absVz = Math.abs(avgVelocity.z);

    // Calculate motion ratios
    const lateralFrac = absVx / speed;
    const verticalFrac = absVy / speed;
    const depthFrac = absVz / speed;

    let type: PunchType = "jab";
    let confidence = 0.5;
    let reason = "default straight strike";

    // Hooks have high lateral speed (horizontal movement)
    if (lateralFrac > 0.52 && lateralFrac > verticalFrac) {
      type = "hook";
      confidence = lateralFrac;
      reason = `dominant lateral vector (${Math.round(lateralFrac * 100)}%)`;
    } 
    // Uppercuts have high upward vertical speed (Y coordinate decreases in screen-space, so velocity.y is negative)
    else if (verticalFrac > 0.48 && avgVelocity.y < 0 && verticalFrac > lateralFrac) {
      type = "uppercut";
      confidence = verticalFrac;
      reason = `dominant vertical rising vector (${Math.round(verticalFrac * 100)}%)`;
    } 
    // Straight punches (Jabs/Crosses) are Z-dominant or straight-forward Y-projected
    else {
      // Stance check: Left hand is orthodox lead (jab), right hand is orthodox rear (cross)
      const isLead = this.side === "left";
      type = isLead ? "jab" : "cross";
      confidence = Math.max(depthFrac, 0.65);
      reason = `straight forward trajectory (${Math.round(depthFrac * 100)}%)`;
    }

    // Force is proportional to the peak speed recorded during the extension phase
    // Scaling: mapping peakSpeed from [0.28, 1.4] to force [0.2, 1.0]
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

  /**
   * Map internal PunchPhase back to the legacy HandState expected by older UI overlays
   */
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
