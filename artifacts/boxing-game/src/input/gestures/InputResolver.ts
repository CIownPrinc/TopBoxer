import type { PunchType } from "../../game/PunchDetector";
import type { CombatInputEvent, GestureCandidate, HandSide } from "../types";
import type { InputSystemConfig } from "../tuning/defaultInputConfig";

const PUNCHES = new Set<string>(["jab", "cross", "hook", "uppercut", "charge"]);

export class InputResolver {
  private lastByHand: Record<HandSide, number> = { left: 0, right: 0 };

  constructor(private readonly config: InputSystemConfig) {}

  resolve(candidate: GestureCandidate | null, sourceFrameId: number): CombatInputEvent | null {
    if (!candidate?.hand || !PUNCHES.has(candidate.type)) return null;
    const type = candidate.type as PunchType;
    const cooldown = this.cooldownFor(type);
    if (candidate.timestampMs - this.lastByHand[candidate.hand] < cooldown) return null;
    this.lastByHand[candidate.hand] = candidate.timestampMs;
    return {
      id: `input-${candidate.id}`,
      type,
      hand: candidate.hand,
      timestamp: candidate.timestampMs,
      force: Math.max(0.2, Math.min(1, candidate.strength)),
      confidence: candidate.confidence,
      stability: candidate.confidence,
      latencyEstimateMs: Math.max(0, performance.now() - candidate.timestampMs),
      sourceFrameId,
    };
  }

  private cooldownFor(type: PunchType): number {
    if (type === "jab") return this.config.punches.jab.cooldownMs;
    if (type === "cross") return this.config.punches.cross.cooldownMs;
    if (type === "hook") return this.config.punches.hook.cooldownMs;
    if (type === "uppercut") return this.config.punches.uppercut.cooldownMs;
    return 720;
  }
}
