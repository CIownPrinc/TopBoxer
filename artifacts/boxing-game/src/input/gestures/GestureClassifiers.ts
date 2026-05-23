import type { HandDebugInfo, PunchType } from "../../game/PunchDetector";
import type { DefenseType, GestureCandidate, HandMotionSample, HandSide, MotionFrame } from "../types";
import type { InputSystemConfig } from "../tuning/defaultInputConfig";
import { PunchClassifierEngine } from "./PunchClassifierEngine";

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function scoreOver(v: number, min: number, range = min): number { return clamp01((v - min) / Math.max(0.001, range)); }

export class PunchClassifier {
  private readonly engines: Record<"left" | "right", PunchClassifierEngine>;

  constructor(private readonly config: InputSystemConfig) {
    this.engines = {
      left: new PunchClassifierEngine("left"),
      right: new PunchClassifierEngine("right"),
    };
  }

  classify(hand: HandMotionSample, debug: HandDebugInfo): GestureCandidate | null {
    const engine = this.engines[hand.side];
    const candidate = engine.update(hand, hand.timestampMs);

    // Sync state machine telemetry back to the legacy UI debug structures
    const legacyState = engine.getLegacyState();
    debug.state = legacyState;

    const telemetry = engine.getTelemetry(hand);
    if (telemetry.lastPunchType) {
      debug.lastGesture = telemetry.lastPunchType;
      debug.confidence = telemetry.lastPunchConfidence;
    }

    return candidate;
  }
}

export class GuardClassifier {
  private guarding = false;
  private enteredAt = 0;

  constructor(private readonly config: InputSystemConfig) {}

  update(frame: MotionFrame): { guarding: boolean; strength: number; candidate: GestureCandidate | null } {
    const l = frame.hands.left;
    const r = frame.hands.right;
    if (!l || !r) {
      this.guarding = false;
      return { guarding: false, strength: 0, candidate: null };
    }
    const radius = frame.calibration.guard.guardRadius;
    const proximity = (1 - clamp01(l.distanceFromGuard / (radius * 2.8)) + 1 - clamp01(r.distanceFromGuard / (radius * 2.8))) / 2;
    const lowMotion = 1 - clamp01(Math.max(l.speed, r.speed) / this.config.defense.guard.maxHandSpeed);
    const height = l.smoothedPosition.y < frame.calibration.guard.lowerGuardY && r.smoothedPosition.y < frame.calibration.guard.lowerGuardY ? 1 : 0.45;
    const strength = clamp01(proximity * 0.55 + lowMotion * 0.25 + height * 0.20);
    if (!this.guarding && strength >= this.config.defense.guard.enterThreshold) {
      this.guarding = true;
      this.enteredAt = frame.timestampMs;
    } else if (this.guarding && strength <= this.config.defense.guard.exitThreshold) {
      this.guarding = false;
    }
    const held = frame.timestampMs - this.enteredAt;
    const candidate = this.guarding && held >= this.config.defense.guard.minHoldMs
      ? { id: `guard-${frame.frameId}`, type: "guard" as const, timestampMs: frame.timestampMs, confidence: strength, strength, durationMs: held, debugReason: "both hands near calibrated guard" }
      : null;
    return { guarding: this.guarding, strength, candidate };
  }
}

export class DodgeClassifier {
  private lastEventAt = 0;

  constructor(private readonly config: InputSystemConfig) {}

  update(frame: MotionFrame): GestureCandidate | null {
    if (frame.timestampMs - this.lastEventAt < this.config.defense.dodge.recoveryMs) return null;
    const lateral = frame.body.lateralOffsetFromCenter;
    const vertical = frame.body.verticalOffsetFromBaseline;
    let type: DefenseType | null = null;
    let amount = 0;
    if (Math.abs(lateral) >= this.config.defense.dodge.minLateralOffset) {
      type = lateral < 0 ? "slip-left" : "slip-right";
      amount = Math.abs(lateral) / 0.18;
    } else if (vertical >= this.config.defense.dodge.minVerticalOffset) {
      type = "duck";
      amount = vertical / 0.16;
    }
    if (!type) return null;
    const confidence = clamp01(amount) * frame.trackingConfidence;
    if (confidence < this.config.defense.dodge.minConfidence) return null;
    this.lastEventAt = frame.timestampMs;
    return { id: `${type}-${frame.frameId}`, type, timestampMs: frame.timestampMs, confidence, strength: confidence, durationMs: 0, debugReason: "guard cluster moved from calibrated body center" };
  }
}
