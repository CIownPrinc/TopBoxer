import { useState, useEffect, useRef } from "react";
import type { GameState } from "../game/GameEngine";

interface HUDProps {
  state: GameState;
}

function HealthBar({
  health,
  label,
  color,
  flipped,
  knockdowns,
  maxKnockdowns,
}: {
  health: number;
  label: string;
  color: string;
  flipped?: boolean;
  knockdowns: number;
  maxKnockdowns: number;
}) {
  const pct = Math.max(0, health);
  const barColor = pct > 55 ? color : pct > 28 ? "#f59e0b" : "#ef4444";
  const isLow = pct < 28;
  const isCritical = pct < 14;

  return (
    <div className={`flex flex-col gap-1 ${flipped ? "items-end" : "items-start"}`} style={{ flex: 1 }}>
      <div className={`flex items-center gap-2 ${flipped ? "flex-row-reverse" : ""}`}>
        <span
          className={`text-xs font-black tracking-widest uppercase ${isCritical ? "vignette-danger" : isLow ? "vignette-warning" : ""}`}
          style={{ color, fontFamily: "monospace" }}
        >
          {label}
        </span>
        <span className="text-xs font-bold tabular-nums" style={{ color: "#aaa" }}>
          {Math.ceil(health)}
        </span>
        {/* Knockdown pips */}
        <div className={`flex gap-1 ${flipped ? "flex-row-reverse" : ""}`}>
          {Array.from({ length: maxKnockdowns }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: i < knockdowns ? "#ff4a17" : "rgba(255,255,255,0.2)",
                boxShadow: i < knockdowns ? "0 0 4px #ff4a17" : "none",
              }}
            />
          ))}
        </div>
      </div>
      <div
        className="w-full rounded-sm overflow-hidden"
        style={{ height: 18, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)" }}
      >
        <div
          className="h-full rounded-sm transition-all duration-200"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
            boxShadow: `0 0 10px ${barColor}, inset 0 1px 0 rgba(255,255,255,0.25)`,
            float: flipped ? "right" : "left",
          }}
        />
      </div>
    </div>
  );
}

function PowerShotOverlay({ type, force, ts }: { type: string | null; force: number; ts: number }) {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState(0);
  const prevTs = useRef(0);

  useEffect(() => {
    if (ts !== prevTs.current && ts > 0 && force >= 0.55) {
      prevTs.current = ts;
      setKey(k => k + 1);
      setVisible(true);
      setTimeout(() => setVisible(false), 600);
    }
  }, [ts, force]);

  if (!visible || !type) return null;

  const isPower = force >= 0.8;
  const label = isPower ? `💥 POWER ${type.toUpperCase()}!` : `${type.toUpperCase()}!`;
  const color = isPower ? "#ffd700" : "#4a90ff";

  return (
    <div
      key={key}
      className="power-flash absolute pointer-events-none"
      style={{
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: isPower ? 52 : 38,
        fontFamily: "monospace",
        fontWeight: 900,
        color,
        textShadow: `0 0 20px ${color}, 0 0 40px ${color}88`,
        whiteSpace: "nowrap",
        letterSpacing: 4,
        zIndex: 40,
      }}
    >
      {label}
    </div>
  );
}

function LowHPVignette({ health }: { health: number }) {
  if (health > 55) return null;
  const intensity = Math.max(0, (55 - health) / 55);
  const isCritical = health < 20;
  const alpha = 0.15 + intensity * 0.5;

  return (
    <div
      className={`absolute inset-0 pointer-events-none ${isCritical ? "vignette-danger" : health < 35 ? "vignette-warning" : ""}`}
      style={{
        background: `radial-gradient(ellipse at center, transparent 30%, rgba(200,0,0,${alpha}) 100%)`,
        zIndex: 15,
      }}
    />
  );
}

function EightCountOverlay({ count, who }: { count: number; who: "player" | "ai" | null }) {
  if (!who) return null;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 35, background: "rgba(0,0,0,0.35)" }}
    >
      <div className="text-center">
        <div
          className="text-base font-black uppercase tracking-widest mb-2"
          style={{ color: "#fff8" }}
        >
          {who === "player" ? "YOU ARE DOWN!" : "CPU IS DOWN!"}
        </div>
        <div
          key={count}
          className="count-pop font-black"
          style={{
            fontSize: 100,
            fontFamily: "monospace",
            color: "#ff4a17",
            textShadow: "0 0 20px #ff4a17, 0 0 60px #ff4a17aa",
            lineHeight: 1,
          }}
        >
          {count}
        </div>
        <div className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>
          REFEREE'S COUNT
        </div>
      </div>
    </div>
  );
}

export function HUD({ state }: HUDProps) {
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const timeColor = state.timeLeft > 20 ? "#fff" : state.timeLeft > 10 ? "#f59e0b" : "#ef4444";
  const showFighting = state.phase === "fighting" || state.phase === "knockdown";

  return (
    <>
      {/* Low HP vignette */}
      <LowHPVignette health={state.playerHealth} />

      {/* Eight-count overlay */}
      {state.phase === "knockdown" && (
        <EightCountOverlay count={state.eightCount} who={state.knockedDown} />
      )}

      {/* Power shot overlay */}
      <PowerShotOverlay
        type={state.lastPunchType}
        force={state.lastPunchForce}
        ts={state.lastPunchTs}
      />

      {/* Main HUD bar */}
      <div
        className="absolute top-0 left-0 right-0 z-20 pointer-events-none"
        style={{ userSelect: "none" }}
      >
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{ background: "rgba(0,0,0,0.8)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <HealthBar
            health={state.playerHealth}
            label="YOU"
            color="#4a90ff"
            knockdowns={state.knockdownCount.player}
            maxKnockdowns={3}
          />

          <div className="flex flex-col items-center shrink-0" style={{ minWidth: 110 }}>
            <div
              className="text-xs font-bold tracking-widest uppercase mb-1"
              style={{ color: "rgba(255,255,255,0.45)" }}
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
                        : "rgba(255,255,255,0.18)",
                    boxShadow:
                      i < state.roundsWon.player ? "0 0 5px #4a90ff" : "none",
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

        {/* Bottom feedback row */}
        {showFighting && (
          <div className="flex items-start justify-between px-4 pt-1">
            <div style={{ minHeight: 28 }}>
              {state.isPlayerBlocking && (
                <span
                  className="text-xs font-black uppercase tracking-widest px-2 py-1 rounded inline-block"
                  style={{
                    background: "rgba(74,144,255,0.25)",
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
                <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "#ffd70066" }}>
                  combo
                </div>
                <div
                  className="text-2xl font-black"
                  style={{ textShadow: "0 0 12px #ffd700", fontFamily: "monospace", color: "#ffd700", lineHeight: 1 }}
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
