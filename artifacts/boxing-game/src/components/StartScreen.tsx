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
  const [hovering, setHovering] = useState(false);

  if (phase === "camera-setup") {
    const allReady = cameraReady && trackingReady;

    return (
      <div
        className="absolute inset-0 flex items-center justify-center z-30"
        style={{ background: "rgba(0,0,0,0.88)" }}
      >
        <div className="text-center max-w-md px-8 w-full">
          <div
            className="text-4xl font-black mb-2"
            style={{ color: "#4a90ff", fontFamily: "monospace", letterSpacing: 4 }}
          >
            CAMERA SETUP
          </div>

          {cameraError ? (
            <div className="mt-4">
              <div
                className="text-sm mb-4 px-4 py-3 rounded-lg"
                style={{
                  background: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.5)",
                  color: "#ef4444",
                }}
              >
                {cameraError}
              </div>
              <button
                data-testid="button-retry-camera"
                onClick={onSetupCamera}
                className="px-6 py-3 rounded-lg font-bold uppercase tracking-widest text-sm"
                style={{
                  background: "rgba(74,144,255,0.2)",
                  border: "1px solid #4a90ff",
                  color: "#4a90ff",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <StatusRow label="Camera access" done={cameraReady} />
              <StatusRow label="Hand tracking model" done={trackingReady} />

              {/* Both hands detection gate */}
              {allReady && (
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl mt-2"
                  style={{
                    background: bothHandsVisible
                      ? "rgba(34,197,94,0.1)"
                      : "rgba(255,74,23,0.08)",
                    border: `1px solid ${bothHandsVisible ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.1)"}`,
                  }}
                >
                  <div className="text-left">
                    <div
                      className="text-sm font-bold"
                      style={{ color: bothHandsVisible ? "#22c55e" : "#fff" }}
                    >
                      {bothHandsVisible ? "✓ Both fists detected!" : "Show both fists"}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                      {bothHandsVisible
                        ? "You're in the right position"
                        : "Hold up both hands so the camera can see them"}
                    </div>
                  </div>
                  <div style={{ fontSize: 28 }}>
                    {bothHandsVisible ? "✊✊" : "👐"}
                  </div>
                </div>
              )}

              {allReady && bothHandsVisible && (
                <div className="mt-6 space-y-3">
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                    Camera position looks good! Start with the tutorial or jump straight into a fight.
                  </p>
                  <button
                    data-testid="button-start-tutorial"
                    onClick={onTutorial}
                    className="px-6 py-3 rounded-lg font-bold uppercase tracking-widest text-sm w-full"
                    style={{
                      background: "rgba(74,144,255,0.18)",
                      border: "1px solid rgba(74,144,255,0.6)",
                      color: "#4a90ff",
                      cursor: "pointer",
                    }}
                  >
                    Tutorial (Recommended)
                  </button>
                  <button
                    data-testid="button-start-match"
                    onClick={onStart}
                    className="px-8 py-4 rounded-lg font-black uppercase tracking-widest text-lg w-full"
                    style={{
                      background: "linear-gradient(135deg, #ff4a17, #cc1111)",
                      color: "#fff",
                      boxShadow: "0 0 20px rgba(255,74,23,0.5)",
                      cursor: "pointer",
                      border: "none",
                    }}
                  >
                    FIGHT! (Skip tutorial)
                  </button>
                </div>
              )}

              {!cameraReady || !trackingReady ? (
                <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Loading... please wait
                </p>
              ) : !bothHandsVisible ? (
                <p className="text-xs mt-3" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Hold both fists up to unlock the FIGHT button
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-30 scanlines"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      <div className="text-center px-8 max-w-lg">
        <div className="mb-2">
          <div
            className="text-6xl font-black tracking-wider"
            style={{
              fontFamily: "monospace",
              color: "#ff4a17",
              textShadow: "0 0 20px #ff4a17, 0 0 40px #ff4a17aa",
              letterSpacing: 8,
            }}
          >
            FIST
          </div>
          <div
            className="text-7xl font-black tracking-wider"
            style={{
              fontFamily: "monospace",
              color: "#fff",
              textShadow: "0 0 20px #fff5",
              letterSpacing: 12,
            }}
          >
            FIGHT
          </div>
          <div
            className="text-xs tracking-widest mt-1"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            ◆ WEBCAM BOXING ◆
          </div>
        </div>

        <div
          className="mt-8 p-5 rounded-xl text-sm space-y-2"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {[
            ["✊", "Punch", "fast hand movement", "#4a90ff"],
            ["🤜", "Hook", "wide sideways swing", "#4a90ff"],
            ["🛡️", "Block", "raise both hands to face", "#ffd700"],
            ["⚡", "Power", "faster = more damage", "#ef4444"],
            ["🥊", "3-KD Rule", "3 knockdowns = TKO", "#ff4a17"],
          ].map(([icon, bold, rest, color]) => (
            <div key={bold} className="flex items-center gap-3">
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span style={{ color: "rgba(255,255,255,0.7)" }}>
                <strong style={{ color: color as string }}>{bold}</strong> — {rest}
              </span>
            </div>
          ))}
        </div>

        <button
          data-testid="button-enable-camera"
          onClick={onSetupCamera}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className="mt-8 px-10 py-5 rounded-xl font-black uppercase tracking-widest text-xl w-full"
          style={{
            background: hovering
              ? "linear-gradient(135deg, #ff6a37, #dd2211)"
              : "linear-gradient(135deg, #ff4a17, #cc1111)",
            color: "#fff",
            boxShadow: hovering
              ? "0 0 30px rgba(255,74,23,0.8)"
              : "0 0 20px rgba(255,74,23,0.5)",
            cursor: "pointer",
            border: "none",
            transform: hovering ? "scale(1.02)" : "scale(1)",
            transition: "all 0.15s",
          }}
        >
          ENABLE CAMERA
        </button>

        <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.25)" }}>
          Requires webcam access • Runs entirely in browser
        </p>
      </div>
    </div>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 rounded-lg"
      style={{ background: "rgba(255,255,255,0.05)" }}
    >
      <span className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
        {label}
      </span>
      {done ? (
        <span style={{ color: "#22c55e" }} className="font-bold text-sm">
          ✓ Ready
        </span>
      ) : (
        <span style={{ color: "#f59e0b" }} className="text-xs animate-pulse">
          Loading...
        </span>
      )}
    </div>
  );
}
