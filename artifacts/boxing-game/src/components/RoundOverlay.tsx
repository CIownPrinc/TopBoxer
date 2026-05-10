import { useEffect, useState } from "react";
import type { GameState } from "../game/GameEngine";

interface RoundOverlayProps {
  state: GameState;
  onRestart: () => void;
}

export function RoundOverlay({ state, onRestart }: RoundOverlayProps) {
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (state.phase === "countdown" || state.phase === "round-end" || state.phase === "game-over") {
      setAnimKey((k) => k + 1);
    }
  }, [state.phase, state.round]);

  if (state.phase === "countdown") {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center z-25 pointer-events-none"
        style={{ background: "rgba(0,0,0,0.55)" }}
      >
        <div className="text-center">
          <div className="text-sm font-bold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.45)" }}>
            Round {state.round}
          </div>
          <div
            key={`${animKey}-${state.countdownValue}`}
            className="countdown-pop font-black tabular-nums"
            style={{
              fontSize: 120,
              fontFamily: "monospace",
              color: state.countdownValue > 1 ? "#fff" : "#ff4a17",
              textShadow:
                state.countdownValue > 1
                  ? "0 0 30px #fff8"
                  : "0 0 40px #ff4a17, 0 0 80px #ff4a17aa",
              lineHeight: 1,
            }}
          >
            {state.countdownValue <= 0 ? "FIGHT!" : state.countdownValue}
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "round-end") {
    const isKO = state.knockedDown !== null;

    return (
      <div
        className="absolute inset-0 flex items-center justify-center z-25"
        style={{ background: "rgba(0,0,0,0.75)" }}
      >
        <div className="text-center">
          {isKO ? (
            <>
              <div
                key={animKey}
                className="ko-slam font-black"
                style={{
                  fontSize: 100,
                  fontFamily: "monospace",
                  color: "#fff",
                  textShadow: "0 0 30px #fff, 0 0 60px #ff4a17",
                  letterSpacing: 8,
                }}
              >
                {state.knockdownCount[state.knockedDown!] >= 3 ? "TKO!" : "KO!"}
              </div>
              <div
                className="text-lg font-bold uppercase tracking-widest mt-2"
                style={{ color: state.knockedDown === "ai" ? "#4a90ff" : "#ef4444" }}
              >
                {state.knockedDown === "ai"
                  ? `You knocked out the CPU${state.knockdownCount.ai >= 3 ? " (TKO)" : ""}!`
                  : `CPU knocked you out${state.knockdownCount.player >= 3 ? " (TKO)" : ""}!`}
              </div>
            </>
          ) : (
            <>
              <div
                className="text-5xl font-black uppercase tracking-widest"
                style={{ color: "#ffd700", fontFamily: "monospace" }}
              >
                Round Over
              </div>
              <div className="text-base mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
                Judge's scorecard...
              </div>
            </>
          )}

          <div className="flex gap-8 justify-center mt-6">
            {(["player", "ai"] as const).map((who) => (
              <div key={who} className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {who === "player" ? "You" : "CPU"}
                </div>
                <div
                  className="text-4xl font-black"
                  style={{ color: who === "player" ? "#4a90ff" : "#ef4444", fontFamily: "monospace" }}
                >
                  {state.roundsWon[who]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "game-over") {
    const playerWon = state.winner === "player";
    return (
      <div
        className="absolute inset-0 flex items-center justify-center z-30"
        style={{ background: "rgba(0,0,0,0.9)" }}
      >
        <div className="text-center px-8 max-w-sm">
          <div
            key={animKey}
            className="ko-slam font-black mb-4"
            style={{
              fontSize: 68,
              fontFamily: "monospace",
              color: playerWon ? "#ffd700" : "#ef4444",
              textShadow: playerWon
                ? "0 0 30px #ffd700, 0 0 60px #ffd70088"
                : "0 0 30px #ef4444",
              letterSpacing: 4,
              lineHeight: 1,
            }}
          >
            {playerWon ? "YOU WIN!" : "KO'd!"}
          </div>
          <div className="text-base mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>
            {playerWon
              ? "Outstanding! You dominated the ring."
              : "The CPU was too strong. Train harder!"}
          </div>

          {/* Score */}
          <div className="flex gap-6 justify-center mt-4 mb-8">
            <div className="text-center">
              <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>You</div>
              <div className="text-5xl font-black" style={{ color: "#4a90ff", fontFamily: "monospace" }}>
                {state.roundsWon.player}
              </div>
            </div>
            <div className="text-4xl font-black self-center" style={{ color: "rgba(255,255,255,0.25)" }}>—</div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>CPU</div>
              <div className="text-5xl font-black" style={{ color: "#ef4444", fontFamily: "monospace" }}>
                {state.roundsWon.ai}
              </div>
            </div>
          </div>

          <button
            data-testid="button-play-again"
            onClick={onRestart}
            className="px-8 py-4 rounded-xl font-black uppercase tracking-widest text-lg w-full"
            style={{
              background: "linear-gradient(135deg, #ff4a17, #cc1111)",
              color: "#fff",
              boxShadow: "0 0 20px rgba(255,74,23,0.5)",
              cursor: "pointer",
              border: "none",
            }}
          >
            FIGHT AGAIN
          </button>
        </div>
      </div>
    );
  }

  return null;
}
