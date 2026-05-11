import { useEffect, useState } from "react";
import type { GameState } from "../game/GameEngine";

interface RoundOverlayProps {
  state: GameState;
  onRestart: () => void;
}

export function RoundOverlay({ state, onRestart }: RoundOverlayProps) {
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (
      state.phase === "countdown" ||
      state.phase === "referee-start" ||
      state.phase === "camera-transition" ||
      state.phase === "round-end" ||
      state.phase === "game-over"
    ) {
      setAnimKey((k) => k + 1);
    }
  }, [state.phase, state.round]);

  // ── Countdown ──────────────────────────────────────────────────────────────
  if (state.phase === "countdown" || state.phase === "referee-start" || state.phase === "camera-transition") {
    const isFight = state.countdownValue <= 0;
    return (
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ background: "rgba(0,0,0,0.52)", zIndex: 25 }}
      >
        <div className="text-center">
          <div
            className="text-sm font-bold uppercase tracking-widest mb-3"
            style={{ color: "rgba(255,255,255,0.4)", letterSpacing: 5 }}
          >
            {state.phase === "camera-transition" ? "Referee: Take your corners" : `Round ${state.round} of ${state.maxRounds}`}
          </div>
          <div
            key={`${animKey}-${state.countdownValue}`}
            className="countdown-pop font-black tabular-nums"
            style={{
              fontSize: isFight ? 80 : 120,
              fontFamily: "monospace",
              letterSpacing: isFight ? 8 : 0,
              color: isFight ? "#ff4a17" : "#fff",
              textShadow: isFight
                ? "0 0 40px #ff4a17, 0 0 80px #ff4a17aa"
                : "0 0 30px rgba(255,255,255,0.5)",
              lineHeight: 1,
            }}
          >
            {state.phase === "camera-transition" ? "STEP IN" : (isFight ? "FIGHT!" : state.countdownValue)}
          </div>
        </div>
      </div>
    );
  }

  // ── Round end ──────────────────────────────────────────────────────────────
  if (state.phase === "round-end") {
    const koVictim = state.knockedDown;
    const isTKO   = koVictim !== null && state.knockdownCount[koVictim] >= 3;
    const isKO    = koVictim !== null;

    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.78)", zIndex: 25 }}
      >
        <div className="text-center px-8">
          {isKO ? (
            <>
              <div
                key={animKey}
                className="ko-slam font-black"
                style={{
                  fontSize: 96,
                  fontFamily: "monospace",
                  color: "#fff",
                  textShadow: "0 0 30px #fff, 0 0 60px #ff4a17",
                  letterSpacing: 6,
                  lineHeight: 1,
                }}
              >
                {isTKO ? "T·K·O" : "K·O"}
              </div>
              <div
                className="text-base font-semibold uppercase tracking-widest mt-3"
                style={{ color: koVictim === "ai" ? "#4a90ff" : "#ef4444" }}
              >
                {koVictim === "ai"
                  ? `You dropped the CPU${isTKO ? " (3 knockdowns)" : ""}!`
                  : `CPU knocked you out${isTKO ? " (3 knockdowns)" : ""}!`}
              </div>
            </>
          ) : (
            <>
              <div
                className="font-black uppercase"
                style={{
                  fontSize: 48,
                  fontFamily: "monospace",
                  color: "#ffd700",
                  textShadow: "0 0 20px #ffd70088",
                  letterSpacing: 4,
                }}
              >
                Round Over
              </div>
              <div className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                Judge's scorecard…
              </div>
            </>
          )}

          {/* Score pills */}
          <div className="flex gap-10 justify-center mt-6">
            {(["player", "ai"] as const).map((who) => (
              <div key={who} className="text-center">
                <div
                  className="text-xs uppercase tracking-widest mb-1"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                >
                  {who === "player" ? "You" : "CPU"}
                </div>
                <div
                  className="text-5xl font-black"
                  style={{
                    color: who === "player" ? "#4a90ff" : "#ef4444",
                    fontFamily: "monospace",
                    textShadow: `0 0 10px ${who === "player" ? "#4a90ff" : "#ef4444"}88`,
                  }}
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

  // ── Game over ──────────────────────────────────────────────────────────────
  if (state.phase === "game-over") {
    const won = state.winner === "player";
    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.92)", zIndex: 30 }}
      >
        <div className="text-center px-8 max-w-sm w-full">
          <div
            key={animKey}
            className="ko-slam font-black"
            style={{
              fontSize: won ? 64 : 72,
              fontFamily: "monospace",
              color: won ? "#ffd700" : "#ef4444",
              textShadow: won
                ? "0 0 30px #ffd700, 0 0 60px #ffd70055"
                : "0 0 30px #ef4444",
              letterSpacing: won ? 6 : 4,
              lineHeight: 1,
            }}
          >
            {won ? "CHAMPION!" : "K·O'd!"}
          </div>
          <p
            className="text-sm mt-3 mb-6"
            style={{ color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}
          >
            {won
              ? "Outstanding performance — you dominated the ring!"
              : "The CPU took this one. Train harder and come back!"}
          </p>

          {/* Score */}
          <div className="flex gap-8 justify-center mb-8">
            {(["player", "ai"] as const).map((who) => (
              <div key={who} className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                  {who === "player" ? "You" : "CPU"}
                </div>
                <div
                  className="text-5xl font-black"
                  style={{
                    color: who === "player" ? "#4a90ff" : "#ef4444",
                    fontFamily: "monospace",
                  }}
                >
                  {state.roundsWon[who]}
                </div>
              </div>
            ))}
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
              letterSpacing: 4,
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
