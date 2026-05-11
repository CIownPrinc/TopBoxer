import { useEffect, useState } from "react";
import type { HandDebugInfo } from "../game/PunchDetector";

interface TutorialStep {
  id: number;
  icon: string;
  title: string;
  desc: string;
  actionHint: string;
  detectKey: "jab" | "hook" | "uppercut" | "block" | "bothHands" | "auto";
}

const STEPS: TutorialStep[] = [
  {
    id: 0,
    icon: "✋",
    title: "Show Both Fists",
    desc: "Hold both fists up in front of the camera so the tracking can see you.",
    actionHint: "Raise both hands into view",
    detectKey: "bothHands",
  },
  {
    id: 1,
    icon: "👊",
    title: "Throw a Jab",
    desc: "Snap one hand forward fast — a quick upward or forward motion counts as a JAB.",
    actionHint: "Quick punch forward!",
    detectKey: "jab",
  },
  {
    id: 2,
    icon: "🤜",
    title: "Throw a Hook",
    desc: "Swing your arm horizontally across your body. A wide sideways sweep = HOOK.",
    actionHint: "Horizontal swing!",
    detectKey: "hook",
  },
  {
    id: 3,
    icon: "🛡️",
    title: "Block",
    desc: "Raise both hands up to face level at the same time — this is your guard.",
    actionHint: "Lift both hands to face!",
    detectKey: "block",
  },
  {
    id: 4,
    icon: "🥊",
    title: "You're Ready!",
    desc: "Faster punches deal more damage. KO the opponent or win 2 of 3 rounds!",
    actionHint: "Starting fight...",
    detectKey: "auto",
  },
];

interface TutorialScreenProps {
  step: number;
  bothHandsVisible: boolean;
  lastPunchType: string | null;
  lastPunchTs: number;
  isBlocking: boolean;
  leftDebug: HandDebugInfo;
  rightDebug: HandDebugInfo;
  onAdvance: () => void;
  onSkip: () => void;
}

export function TutorialScreen({
  step,
  bothHandsVisible,
  lastPunchType,
  lastPunchTs,
  isBlocking,
  leftDebug,
  rightDebug,
  onAdvance,
  onSkip,
}: TutorialScreenProps) {
  const [completed, setCompleted] = useState(false);
  const [prevPunchTs, setPrevPunchTs] = useState(0);

  const current = STEPS[Math.min(step, STEPS.length - 1)];

  // Check completion condition
  useEffect(() => {
    if (completed) return;
    const key = current.detectKey;
    let met = false;

    if (key === "auto") {
      met = true;
    } else if (key === "bothHands") {
      met = bothHandsVisible;
    } else if (key === "block") {
      met = isBlocking;
    } else if ((key === "jab" || key === "hook" || key === "uppercut") && lastPunchTs !== prevPunchTs) {
      // A punch was thrown — accept any punch for jab, need hook for hook
      if (key === "jab" && lastPunchTs > 0) met = true;
      if (key === "hook" && lastPunchType === "hook") met = true;
    }

    if (met) {
      setCompleted(true);
      if (lastPunchTs !== prevPunchTs) setPrevPunchTs(lastPunchTs);
      const delay = key === "auto" ? 2200 : 900;
      setTimeout(() => {
        setCompleted(false);
        onAdvance();
      }, delay);
    }
  }, [bothHandsVisible, lastPunchTs, lastPunchType, isBlocking, current.detectKey, completed, onAdvance, prevPunchTs]);

  // Reset completed when step advances
  useEffect(() => {
    setCompleted(false);
  }, [step]);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-30"
      style={{ background: "rgba(0,0,0,0.87)" }}
    >
      <div className="text-center max-w-md px-8 w-full">
        {/* Header */}
        <div
          className="text-xs font-black uppercase tracking-widest mb-6"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          Tutorial  {step + 1} / {STEPS.length}
        </div>

        {/* Step indicator */}
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((s) => (
            <div
              key={s.id}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background:
                  s.id < step
                    ? "#22c55e"
                    : s.id === step
                    ? "#4a90ff"
                    : "rgba(255,255,255,0.15)",
                boxShadow: s.id === step ? "0 0 8px #4a90ff" : "none",
                transition: "all 0.3s",
              }}
            />
          ))}
        </div>

        {/* Icon */}
        <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 16 }}>
          {current.icon}
        </div>

        {/* Title */}
        <div
          className="text-3xl font-black mb-3"
          style={{
            color: completed ? "#22c55e" : "#fff",
            fontFamily: "monospace",
            letterSpacing: 2,
            transition: "color 0.3s",
          }}
        >
          {completed ? "✓ DONE!" : current.title}
        </div>

        {/* Description */}
        <p
          className="text-sm mb-8 leading-relaxed"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          {current.desc}
        </p>

        {/* Action prompt */}
        <div
          className={`px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-widest ${!completed ? "step-glow" : ""}`}
          style={{
            background: completed
              ? "rgba(34,197,94,0.2)"
              : "rgba(74,144,255,0.15)",
            border: `1px solid ${completed ? "#22c55e" : "#4a90ff"}`,
            color: completed ? "#22c55e" : "#4a90ff",
            transition: "all 0.3s",
          }}
        >
          {completed ? "Great! Moving on..." : `👉 ${current.actionHint}`}
        </div>

        <div className="mt-4 text-xs" style={{ color: "rgba(255,255,255,0.55)", fontFamily: "monospace" }}>
          <div>Tracking conf: {Math.round(((leftDebug.trackingConfidence + rightDebug.trackingConfidence) / 2) * 100)}%</div>
          <div>
            L: {leftDebug.lastGesture.toUpperCase()} ({leftDebug.speed.toFixed(2)}) ·
            R: {rightDebug.lastGesture.toUpperCase()} ({rightDebug.speed.toFixed(2)})
          </div>
          <div>
            {completed ? "✅ Gesture recognized" : "Move clearly: small accidental motions are ignored."}
          </div>
        </div>

        {/* Skip */}
        <button
          data-testid="button-skip-tutorial"
          onClick={onSkip}
          className="mt-6 text-xs"
          style={{ color: "rgba(255,255,255,0.3)", cursor: "pointer", background: "none", border: "none" }}
        >
          Skip tutorial →
        </button>
      </div>
    </div>
  );
}
