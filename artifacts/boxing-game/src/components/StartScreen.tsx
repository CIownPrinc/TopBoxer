import { useState } from "react";

interface StartScreenProps {
  onStart: () => void;
  onSetupCamera: () => void;
  onTutorial: () => void;
  phase: "start" | "camera-setup";
  cameraReady: boolean;
  trackingReady: boolean;
  cameraError: string | null;
  bothHandsVisible: boolean;
}

export function StartScreen({
  onStart,
  onSetupCamera,
  onTutorial,
  phase,
  cameraReady,
  trackingReady,
  cameraError,
  bothHandsVisible,
}: StartScreenProps) {
  const [hoveringFight, setHoveringFight] = useState(false);
  const [hoveringCamera, setHoveringCamera] = useState(false);

  if (phase === "camera-setup") {
    const allReady = cameraReady && trackingReady;

    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.88)", zIndex: 30 }}
      >
        <div className="text-center max-w-sm px-8 w-full">
          <div
            className="text-3xl font-black mb-1"
            style={{ color: "#4a90ff", fontFamily: "monospace", letterSpacing: 4 }}
          >
            CAMERA SETUP
          </div>
          <p className="text-xs mb-6" style={{ color: "rgba(255,255,255,0.3)", letterSpacing: 2 }}>
            ◆ GETTING READY ◆
          </p>

          {cameraError ? (
            <div className="space-y-4">
              <div
                className="text-sm px-4 py-3 rounded-lg text-left"
                style={{
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.4)",
                  color: "#ef4444",
                }}
              >
                {cameraError}
              </div>
              <button
                data-testid="button-retry-camera"
                onClick={onSetupCamera}
                className="px-6 py-3 rounded-lg font-bold uppercase tracking-widest text-sm w-full"
                style={{
                  background: "rgba(74,144,255,0.15)",
                  border: "1px solid rgba(74,144,255,0.5)",
                  color: "#4a90ff",
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Status checklist */}
              <StatusRow label="Camera access" done={cameraReady} />
              <StatusRow label="Hand tracking AI" done={trackingReady} />

              {/* Hands indicator — informational only, not a gate */}
              {allReady && (
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300"
                  style={{
                    background: bothHandsVisible
                      ? "rgba(34,197,94,0.1)"
                      : "rgba(255,255,255,0.04)",
                    border: `1px solid ${bothHandsVisible ? "rgba(34,197,94,0.45)" : "rgba(255,255,255,0.1)"}`,
                  }}
                >
                  <div className="text-left">
                    <div
                      className="text-sm font-semibold"
                      style={{ color: bothHandsVisible ? "#22c55e" : "rgba(255,255,255,0.6)" }}
                    >
                      {bothHandsVisible ? "✓ Both fists visible" : "Fists not yet visible"}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Camera check • optional at this step
                    </div>
                  </div>
                  <div style={{ fontSize: 22, opacity: bothHandsVisible ? 1 : 0.35 }}>
                    {bothHandsVisible ? "✊✊" : "👐"}
                  </div>
                </div>
              )}

              {/* Buttons — available as soon as camera+tracking are ready */}
              {allReady ? (
                <div className="pt-3 space-y-3">
                  <p className="text-xs pb-1" style={{ color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                    You'll be prompted to raise both fists before the fight begins.
                  </p>
                  <button
                    data-testid="button-start-tutorial"
                    onClick={onTutorial}
                    className="px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-sm w-full transition-all duration-150"
                    style={{
                      background: "rgba(74,144,255,0.15)",
                      border: "1px solid rgba(74,144,255,0.55)",
                      color: "#4a90ff",
                      cursor: "pointer",
                    }}
                  >
                    📖 Tutorial (Recommended)
                  </button>
                  <button
                    data-testid="button-start-match"
                    onClick={onStart}
                    onMouseEnter={() => setHoveringFight(true)}
                    onMouseLeave={() => setHoveringFight(false)}
                    className="px-8 py-4 rounded-xl font-black uppercase tracking-widest text-lg w-full"
                    style={{
                      background: hoveringFight
                        ? "linear-gradient(135deg, #ff6a37, #dd2211)"
                        : "linear-gradient(135deg, #ff4a17, #cc1111)",
                      color: "#fff",
                      boxShadow: hoveringFight
                        ? "0 0 28px rgba(255,74,23,0.75)"
                        : "0 0 16px rgba(255,74,23,0.45)",
                      cursor: "pointer",
                      border: "none",
                      transform: hoveringFight ? "scale(1.02)" : "scale(1)",
                      transition: "all 0.15s",
                    }}
                  >
                    🥊 FIGHT!
                  </button>
                </div>
              ) : (
                <p className="text-xs pt-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Loading hand tracking model…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main start screen ──────────────────────────────────────────────────────
  return (
    <div
      className="absolute inset-0 flex items-center justify-center scanlines"
      style={{ background: "rgba(0,0,0,0.92)", zIndex: 30 }}
    >
      <div className="text-center px-8 max-w-md">
        {/* Logo */}
        <div className="mb-2">
          <div
            className="font-black"
            style={{
              fontFamily: "monospace",
              fontSize: "clamp(44px, 10vw, 72px)",
              color: "#ff4a17",
              textShadow: "0 0 20px #ff4a17, 0 0 40px #ff4a17aa",
              letterSpacing: 10,
              lineHeight: 1.1,
            }}
          >
            FIST
          </div>
          <div
            className="font-black"
            style={{
              fontFamily: "monospace",
              fontSize: "clamp(52px, 12vw, 88px)",
              color: "#fff",
              textShadow: "0 0 20px #fff4",
              letterSpacing: 12,
              lineHeight: 1,
            }}
          >
            FIGHT
          </div>
          <div className="text-xs tracking-widest mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>
            ◆ WEBCAM BOXING ◆
          </div>
        </div>

        {/* Move list */}
        <div
          className="mt-7 p-4 rounded-xl text-sm"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[
              ["✊", "Jab / Hook / Uppercut", "#4a90ff"],
              ["🛡️", "Block — raise both hands", "#ffd700"],
              ["⚡", "Faster punch = more damage", "#ef4444"],
              ["🥊", "3 knockdowns = TKO", "#ff4a17"],
            ].map(([icon, text, color]) => (
              <div key={text} className="flex items-start gap-2 text-left">
                <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                <span style={{ color: color as string, fontSize: 12, lineHeight: 1.4 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          data-testid="button-enable-camera"
          onClick={onSetupCamera}
          onMouseEnter={() => setHoveringCamera(true)}
          onMouseLeave={() => setHoveringCamera(false)}
          className="mt-7 px-10 py-5 rounded-xl font-black uppercase tracking-widest w-full"
          style={{
            fontSize: "clamp(16px, 2.5vw, 20px)",
            background: hoveringCamera
              ? "linear-gradient(135deg, #ff6a37, #dd2211)"
              : "linear-gradient(135deg, #ff4a17, #cc1111)",
            color: "#fff",
            boxShadow: hoveringCamera
              ? "0 0 32px rgba(255,74,23,0.8)"
              : "0 0 20px rgba(255,74,23,0.5)",
            cursor: "pointer",
            border: "none",
            transform: hoveringCamera ? "scale(1.025)" : "scale(1)",
            transition: "all 0.15s",
          }}
        >
          ENABLE CAMERA
        </button>
        <p className="text-xs mt-3" style={{ color: "rgba(255,255,255,0.2)" }}>
          Webcam required · Runs entirely in your browser
        </p>
      </div>
    </div>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 rounded-lg"
      style={{ background: "rgba(255,255,255,0.05)" }}
    >
      <span className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
        {label}
      </span>
      {done ? (
        <span className="text-sm font-bold" style={{ color: "#22c55e" }}>✓ Ready</span>
      ) : (
        <span className="text-xs animate-pulse" style={{ color: "#f59e0b" }}>Loading…</span>
      )}
    </div>
  );
}
