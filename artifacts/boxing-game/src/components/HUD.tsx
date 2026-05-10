import { useState, useEffect, useRef } from "react";
import type { GameState } from "../game/GameEngine";
import type { PunchType } from "../game/PunchDetector";

interface HUDProps { state: GameState }

// ── Health bar ─────────────────────────────────────────────────────────────────
function HealthBar({
  health, label, color, flipped, knockdowns, maxKnockdowns,
}: {
  health: number; label: string; color: string;
  flipped?: boolean; knockdowns: number; maxKnockdowns: number;
}) {
  const pct      = Math.max(0, health);
  const barColor = pct > 55 ? color : pct > 28 ? "#f59e0b" : "#ef4444";
  const isLow    = pct < 28;
  const isCrit   = pct < 14;

  return (
    <div className={`flex flex-col gap-1 ${flipped ? "items-end" : "items-start"}`} style={{ flex: 1 }}>
      <div className={`flex items-center gap-2 ${flipped ? "flex-row-reverse" : ""}`}>
        <span
          className={`text-xs font-black tracking-widest uppercase ${isCrit ? "vignette-danger" : isLow ? "vignette-warning" : ""}`}
          style={{ color, fontFamily: "monospace" }}
        >
          {label}
        </span>
        <span className="text-xs font-bold tabular-nums" style={{ color: "#999" }}>
          {Math.ceil(health)}
        </span>
        <div className={`flex gap-1 ${flipped ? "flex-row-reverse" : ""}`}>
          {Array.from({ length: maxKnockdowns }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 7, height: 7, borderRadius: "50%",
                background: i < knockdowns ? "#ff4a17" : "rgba(255,255,255,0.18)",
                boxShadow: i < knockdowns ? "0 0 4px #ff4a17" : "none",
              }}
            />
          ))}
        </div>
      </div>
      <div
        className="w-full rounded-sm overflow-hidden"
        style={{ height: 16, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        <div
          className="h-full rounded-sm transition-all duration-150"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
            boxShadow: `0 0 8px ${barColor}88, inset 0 1px 0 rgba(255,255,255,0.2)`,
            float: flipped ? "right" : "left",
          }}
        />
      </div>
    </div>
  );
}

// ── Power / charge shot overlay ────────────────────────────────────────────────
const POWER_LABELS: Record<PunchType, { label: string; color: string; big: boolean }> = {
  jab:      { label: "JAB!",       color: "#4a90ff", big: false },
  hook:     { label: "HOOK!",      color: "#a78bfa", big: false },
  uppercut: { label: "UPPERCUT!",  color: "#fbbf24", big: false },
  charge:   { label: "⚡ CHARGE!", color: "#ff4a17", big: true  },
};

function PowerShotOverlay({ type, force, ts }: { type: PunchType | null; force: number; ts: number }) {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState(0);
  const prevTs = useRef(0);

  useEffect(() => {
    if (ts !== prevTs.current && ts > 0 && (force >= 0.5 || type === "charge")) {
      prevTs.current = ts;
      setKey((k) => k + 1);
      setVisible(true);
      setTimeout(() => setVisible(false), type === "charge" ? 750 : 550);
    }
  }, [ts, force, type]);

  if (!visible || !type) return null;
  const meta  = POWER_LABELS[type] ?? POWER_LABELS.jab;
  const isPow = force >= 0.78 || type === "charge";
  const label = isPow && type !== "charge" ? `💥 ${meta.label}` : meta.label;
  const color = meta.color;
  const sz    = meta.big || isPow ? 52 : 38;

  return (
    <div
      key={key}
      className="power-flash absolute pointer-events-none"
      style={{
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: sz,
        fontFamily: "monospace",
        fontWeight: 900,
        color,
        textShadow: `0 0 20px ${color}, 0 0 50px ${color}88`,
        whiteSpace: "nowrap",
        letterSpacing: 4,
        zIndex: 40,
      }}
    >
      {label}
    </div>
  );
}

// ── Low HP vignette ────────────────────────────────────────────────────────────
function LowHPVignette({ health }: { health: number }) {
  if (health > 55) return null;
  const intensity = Math.max(0, (55 - health) / 55);
  const alpha     = 0.15 + intensity * 0.5;
  const isCrit    = health < 20;

  return (
    <div
      className={`absolute inset-0 pointer-events-none ${isCrit ? "vignette-danger" : health < 35 ? "vignette-warning" : ""}`}
      style={{
        background: `radial-gradient(ellipse at center, transparent 25%, rgba(200,0,0,${alpha}) 100%)`,
        zIndex: 15,
      }}
    />
  );
}

// ── 8-count overlay ────────────────────────────────────────────────────────────
function EightCountOverlay({ count, who }: { count: number; who: "player" | "ai" | null }) {
  if (!who) return null;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ background: "rgba(0,0,0,0.38)", zIndex: 35 }}
    >
      <div className="text-center">
        <div
          className="text-sm font-black uppercase tracking-widest mb-2"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          {who === "player" ? "YOU ARE DOWN!" : "CPU IS DOWN!"}
        </div>
        <div
          key={count}
          className="count-pop font-black"
          style={{
            fontSize: 100, fontFamily: "monospace",
            color: "#ff4a17", lineHeight: 1,
            textShadow: "0 0 20px #ff4a17, 0 0 60px #ff4a17aa",
          }}
        >
          {count}
        </div>
        <div className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
          REFEREE'S COUNT
        </div>
      </div>
    </div>
  );
}

// ── Main HUD ───────────────────────────────────────────────────────────────────
export function HUD({ state }: HUDProps) {
  const fmt  = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const timeC = state.timeLeft > 20 ? "#fff" : state.timeLeft > 10 ? "#f59e0b" : "#ef4444";
  const showFighting = state.phase === "fighting" || state.phase === "knockdown";

  return (
    <>
      <LowHPVignette health={state.playerHealth} />

      {state.phase === "knockdown" && (
        <EightCountOverlay count={state.eightCount} who={state.knockedDown} />
      )}

      <PowerShotOverlay
        type={state.lastPunchType}
        force={state.lastPunchForce}
        ts={state.lastPunchTs}
      />

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{ zIndex: 20, userSelect: "none" }}
      >
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{ background: "rgba(0,0,0,0.82)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <HealthBar
            health={state.playerHealth}
            label="YOU"
            color="#4a90ff"
            knockdowns={state.knockdownCount.player}
            maxKnockdowns={3}
          />
          <div className="flex flex-col items-center shrink-0" style={{ minWidth: 105 }}>
            <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              Round {state.round}/{state.maxRounds}
            </div>
            <div
              className="text-2xl font-black tabular-nums"
              style={{ color: timeC, fontFamily: "monospace", textShadow: `0 0 10px ${timeC}`, lineHeight: 1 }}
            >
              {fmt(state.timeLeft)}
            </div>
            {/* Round score pips */}
            <div className="flex gap-1 mt-1">
              {Array.from({ length: state.maxRounds }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background:
                      i < state.roundsWon.player ? "#4a90ff"
                      : i >= state.maxRounds - state.roundsWon.ai ? "#ef4444"
                      : "rgba(255,255,255,0.15)",
                    boxShadow: i < state.roundsWon.player ? "0 0 5px #4a90ff" : "none",
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
            knockdowns={state.knockdownCount.ai}
            maxKnockdowns={3}
          />
        </div>

        {/* Status row */}
        {showFighting && (
          <div className="flex items-start justify-between px-4 pt-1">
            <div style={{ minHeight: 28 }}>
              {state.isPlayerBlocking && (
                <span
                  className="text-xs font-black uppercase tracking-widest px-2 py-1 rounded inline-block"
                  style={{
                    background: "rgba(74,144,255,0.22)",
                    border: "1px solid #4a90ff",
                    color: "#4a90ff",
                  }}
                >
                  🛡 BLOCKING
                </span>
              )}
            </div>
            {state.comboCount > 1 && (
              <div className="text-right">
                <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "#ffd70055" }}>
                  combo
                </div>
                <div
                  className="text-2xl font-black"
                  style={{ color: "#ffd700", fontFamily: "monospace", textShadow: "0 0 12px #ffd700", lineHeight: 1 }}
                >
                  x{state.comboCount}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
