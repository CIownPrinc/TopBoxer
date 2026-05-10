import { useState, useEffect, useRef } from "react";
import type { GameState } from "../game/GameEngine";

interface HUDProps {
  state: GameState;
}

function HealthBar({
  health,
  max = 100,
  label,
  color,
  flipped,
}: {
  health: number;
  max?: number;
  label: string;
  color: string;
  flipped?: boolean;
}) {
  const pct = Math.max(0, (health / max) * 100);
  const barColor =
    pct > 60 ? color : pct > 30 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className={`flex flex-col gap-1 ${flipped ? "items-end" : "items-start"}`}
      style={{ flex: 1 }}
    >
      <div
        className={`flex items-center gap-2 ${flipped ? "flex-row-reverse" : ""}`}
      >
        <span
          className="text-xs font-black tracking-widest uppercase"
          style={{ color, fontFamily: "monospace" }}
        >
          {label}
        </span>
        <span
          className="text-xs font-bold tabular-nums"
          style={{ color: "#aaa" }}
        >
          {Math.ceil(health)}
        </span>
      </div>
      <div
        className="w-full rounded-sm overflow-hidden"
        style={{
          height: 16,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.15)",
        }}
      >
        <div
          className="h-full rounded-sm transition-all duration-150"
          style={{
            width: `${pct}%`,
            background: barColor,
            boxShadow: `0 0 8px ${barColor}`,
            float: flipped ? "right" : "left",
          }}
        />
      </div>
    </div>
  );
}

export function HUD({ state }: HUDProps) {
  const [flashPunch, setFlashPunch] = useState(false);
  const prevPunchInfo = useRef(state.lastPunchInfo);

  useEffect(() => {
    if (state.lastPunchInfo !== prevPunchInfo.current && state.lastPunchInfo) {
      prevPunchInfo.current = state.lastPunchInfo;
      setFlashPunch(true);
      setTimeout(() => setFlashPunch(false), 400);
    }
  }, [state.lastPunchInfo]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const timeColor =
    state.timeLeft > 20 ? "#fff" : state.timeLeft > 10 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className="absolute top-0 left-0 right-0 z-20 pointer-events-none"
      style={{ userSelect: "none" }}
    >
      {/* Main HUD bar */}
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{ background: "rgba(0,0,0,0.75)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <HealthBar
          health={state.playerHealth}
          label="YOU"
          color="#4a90ff"
        />

        {/* Center info */}
        <div className="flex flex-col items-center shrink-0" style={{ minWidth: 100 }}>
          <div
            className="text-xs font-bold tracking-widest uppercase mb-1"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            Round {state.round}/{state.maxRounds}
          </div>
          <div
            className="text-2xl font-black tabular-nums"
            style={{
              color: timeColor,
              fontFamily: "monospace",
              textShadow: `0 0 10px ${timeColor}`,
              lineHeight: 1,
            }}
          >
            {formatTime(state.timeLeft)}
          </div>
          <div className="flex gap-1 mt-1">
            {Array.from({ length: state.maxRounds }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    i < state.roundsWon.player
                      ? "#4a90ff"
                      : i >= state.maxRounds - state.roundsWon.ai
                      ? "#ef4444"
                      : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>
        </div>

        <HealthBar
          health={state.aiHealth}
          label="CPU"
          color="#ef4444"
          flipped
        />
      </div>

      {/* Punch info + combo */}
      {state.phase === "fighting" && (
        <div className="flex items-start justify-between px-4 pt-1">
          <div style={{ minHeight: 24 }}>
            {flashPunch && state.lastPunchInfo && (
              <span
                className="text-sm font-bold uppercase tracking-widest punch-flash inline-block"
                style={{ color: "#4a90ff" }}
              >
                {state.lastPunchInfo}
              </span>
            )}
          </div>

          {state.comboCount > 1 && (
            <div
              className="text-right"
              style={{ color: "#ffd700" }}
            >
              <div
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: "#ffd70088" }}
              >
                combo
              </div>
              <div
                className="text-2xl font-black"
                style={{
                  textShadow: "0 0 12px #ffd700",
                  fontFamily: "monospace",
                  lineHeight: 1,
                }}
              >
                x{state.comboCount}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Blocking indicator */}
      {state.isPlayerBlocking && state.phase === "fighting" && (
        <div
          className="absolute left-4 bottom-full mb-2 text-xs font-black uppercase tracking-widest px-2 py-1 rounded"
          style={{
            background: "rgba(74,144,255,0.3)",
            border: "1px solid #4a90ff",
            color: "#4a90ff",
          }}
        >
          BLOCKING
        </div>
      )}
    </div>
  );
}
