import type { HandDebugInfo, PunchType } from "../../game/PunchDetector";
import type { DefenseType, GestureCandidate, HandMotionSample, HandSide, MotionFrame } from "../types";
import type { InputSystemConfig } from "../tuning/defaultInputConfig";

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function scoreOver(v: number, min: number, range = min): number { return clamp01((v - min) / Math.max(0.001, range)); }

export class PunchClassifier {
  constructor(private readonly config: InputSystemConfig) {}

  classify(hand: HandMotionSample, debug: HandDebugInfo): GestureCandidate | null {
    if (debug.lastGesture === "charge") {
      return this.candidate("charge", hand, debug.confidence, hand.extensionRatio, "legacy charge state");
    }

    const forwardUp = Math.max(0, -hand.velocity.y);
    const downward = Math.max(0, hand.velocity.y);
    const lateral = Math.abs(hand.velocity.x);
    const dominantStraight = forwardUp >= lateral * 0.85;
    const cfg = this.config.punches;
    const straightType: PunchType = this.isLeadHand(hand.side) ? "jab" : "cross";

    const candidates: Array<{ type: PunchType; score: number; reason: string }> = [];
    const straightCfg = straightType === "jab" ? cfg.jab : cfg.cross;
    if (dominantStraight) {
      const s = scoreOver(hand.speed, straightCfg.minSpeed, 0.35)
        * scoreOver(hand.extensionRatio, straightCfg.minExtension, 0.35)
        * clamp01(1 - Math.max(0, hand.lateralRatio - (straightType === "jab" ? cfg.jab.maxLateralRatio : 0.82)))
        * hand.quality.confidence;
      candidates.push({ type: straightType, score: s, reason: "straight extension from guard" });
    }

    const hookScore = scoreOver(hand.speed, cfg.hook.minSpeed, 0.35)
      * scoreOver(hand.lateralRatio, cfg.hook.minLateralRatio, 0.35)
      * clamp01(1 - Math.max(0, hand.forwardRatio - cfg.hook.maxForwardRatio))
      * hand.quality.confidence;
    candidates.push({ type: "hook", score: hookScore, reason: "lateral velocity dominant" });

    const upperScore = scoreOver(hand.speed, cfg.uppercut.minSpeed, 0.35)
      * scoreOver(downward / Math.max(0.001, hand.speed), cfg.uppercut.minUpwardRatio, 0.35)
      * scoreOver(hand.extensionRatio, cfg.uppercut.minExtension, 0.35)
      * hand.quality.confidence;
    candidates.push({ type: "uppercut", score: upperScore, reason: "rising/vertical attack" });

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    const minConfidence = best.type === "jab" ? cfg.jab.minConfidence : best.type === "cross" ? cfg.cross.minConfidence : best.type === "hook" ? cfg.hook.minConfidence : cfg.uppercut.minConfidence;
    if (best.score < minConfidence) return null;
    return this.candidate(best.type, hand, best.score, hand.extensionRatio, best.reason);
  }

  private isLeadHand(side: HandSide): boolean {
    // Default calibration stance is orthodox: left jab, right cross.
    return side === "left";
  }

  private candidate(type: PunchType, hand: HandMotionSample, confidence: number, strength: number, debugReason: string): GestureCandidate {
    return { id: `${type}-${hand.side}-${hand.timestampMs}`, type, hand: hand.side, timestampMs: hand.timestampMs, confidence: clamp01(confidence), strength: clamp01(strength), durationMs: 0, debugReason };
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
