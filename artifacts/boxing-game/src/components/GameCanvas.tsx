import { useEffect, useRef, useState, useCallback } from "react";
import { HandTracker } from "../game/HandTracker";
import { PunchDetector } from "../game/PunchDetector";
import { createScene } from "../game/SceneManager";
import type { IScene } from "../game/SceneManager";
import { GameEngine } from "../game/GameEngine";
import type { GameState } from "../game/GameEngine";
import { HUD } from "./HUD";
import { StartScreen } from "./StartScreen";
import { RoundOverlay } from "./RoundOverlay";
import { TutorialScreen } from "./TutorialScreen";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

interface HandOverlayDot {
  x: number;
  y: number;
  hand: "left" | "right";
}

type ShakeLevel = "" | "shake-sm" | "shake-md" | "shake-lg";

// ── ReadyCheck overlay — "raise both fists" gate before fight ─────────────────
function ReadyCheckOverlay({
  bothHandsVisible,
  onSkip,
}: {
  bothHandsVisible: boolean;
  onSkip: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)", zIndex: 30 }}
    >
      <div className="text-center px-8 max-w-sm">
        <div
          className="font-black mb-4"
          style={{
            fontFamily: "monospace",
            fontSize: 48,
            letterSpacing: 4,
            color: bothHandsVisible ? "#22c55e" : "#fff",
            textShadow: bothHandsVisible ? "0 0 20px #22c55e" : undefined,
            transition: "color 0.3s, text-shadow 0.3s",
          }}
        >
          {bothHandsVisible ? "✊ READY! ✊" : "✊ GET READY ✊"}
        </div>

        <p className="text-sm mb-8" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          {bothHandsVisible
            ? "Starting countdown…"
            : "Raise both fists in front of the camera to begin the fight."}
        </p>

        {/* Live hand detection dots */}
        <div className="flex justify-center gap-6 mb-8">
          {(["Left fist", "Right fist"] as const).map((label, i) => {
            const detected = i === 0 ? bothHandsVisible : bothHandsVisible;
            // We show both green or both grey based on combined state
            return (
              <div key={label} className="text-center">
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    border: `3px solid ${bothHandsVisible ? "#22c55e" : "rgba(255,255,255,0.2)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    margin: "0 auto 8px",
                    background: bothHandsVisible ? "rgba(34,197,94,0.15)" : "transparent",
                    boxShadow: bothHandsVisible ? "0 0 16px rgba(34,197,94,0.5)" : "none",
                    transition: "all 0.3s",
                  }}
                >
                  ✊
                </div>
                <div
                  className="text-xs"
                  style={{ color: bothHandsVisible ? "#22c55e" : "rgba(255,255,255,0.3)" }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {!bothHandsVisible && (
          <div
            className="step-glow inline-block px-5 py-2 rounded-lg text-sm font-bold mb-6"
            style={{
              border: "1px solid rgba(74,144,255,0.4)",
              color: "rgba(74,144,255,0.8)",
              background: "rgba(74,144,255,0.08)",
            }}
          >
            Hold both fists up to the camera
          </div>
        )}

        <br />
        <button
          onClick={onSkip}
          className="text-xs mt-4"
          style={{
            color: "rgba(255,255,255,0.25)",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Skip hands check →
        </button>
      </div>
    </div>
  );
}

export function GameCanvas() {
  const gameCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamRef    = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const trackerRef  = useRef<HandTracker | null>(null);
  const detectorRef = useRef<PunchDetector | null>(null);
  const sceneRef    = useRef<IScene | null>(null);
  const engineRef   = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>({
    phase: "start",
    round: 1,
    maxRounds: 3,
    playerHealth: 100,
    aiHealth: 100,
    timeLeft: 60,
    roundsWon: { player: 0, ai: 0 },
    knockedDown: null,
    knockdownCount: { player: 0, ai: 0 },
    eightCount: 8,
    winner: null,
    countdownValue: 3,
    isPlayerBlocking: false,
    isAIBlocking: false,
    lastPunchType: null,
    lastPunchForce: 0,
    lastPunchTs: 0,
    comboCount: 0,
    tutorialStep: 0,
  });

  const [cameraReady, setCameraReady]     = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [cameraError, setCameraError]     = useState<string | null>(null);
  const [handDots, setHandDots]           = useState<HandOverlayDot[]>([]);
  const [bothHandsVisible, setBothHandsVisible] = useState(false);
  const [shakeClass, setShakeClass]       = useState<ShakeLevel>("");
  const [readyCheck, setReadyCheck]       = useState(false); // "raise fists" gate
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-advance from readyCheck when both hands visible ──────────────────
  useEffect(() => {
    if (!readyCheck || !bothHandsVisible) return;
    // Small debounce so the "READY!" flash is visible
    const t = setTimeout(() => {
      setReadyCheck(false);
      engineRef.current?.startMatch();
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    }, 600);
    return () => clearTimeout(t);
  }, [readyCheck, bothHandsVisible]);

  // ── Scene ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas    = gameCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;

    const scene = createScene(canvas);
    scene.startRendering();
    sceneRef.current = scene;

    const handleResize = () => {
      if (!container) return;
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
      scene.resize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); scene.dispose(); };
  }, []);

  // ── Camera shake ──────────────────────────────────────────────────────────
  const triggerShake = useCallback((force: number) => {
    const level: ShakeLevel =
      force >= 0.85 ? "shake-lg" : force >= 0.55 ? "shake-md" : "shake-sm";
    setShakeClass(level);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShakeClass(""), 600);
  }, []);

  // ── Game engine ───────────────────────────────────────────────────────────
  useEffect(() => {
    const engine = new GameEngine();
    engine.onState(setGameState);
    engine.onHit((target, force) => {
      if (target === "ai") sceneRef.current?.triggerAIHit();
      else { sceneRef.current?.triggerPlayerHit(); triggerShake(force); }
    });
    engine.setAIPunchCallback((hand) => sceneRef.current?.triggerAIPunch(hand));
    engineRef.current = engine;
    return () => engine.reset();
  }, [triggerShake]);

  // ── Hand tracker + punch detector ─────────────────────────────────────────
  useEffect(() => {
    const tracker  = new HandTracker();
    const detector = new PunchDetector();
    trackerRef.current  = tracker;
    detectorRef.current = detector;

    detector.onPunch((event) => {
      engineRef.current?.playerPunch(event);
      sceneRef.current?.triggerPlayerPunch(event.hand);
    });

    tracker.onTrack((data) => {
      detector.update(data.left, data.right);
      engineRef.current?.setPlayerBlocking(detector.isBlocking());
      setBothHandsVisible(detector.getBothHandsVisible());

      const dots: HandOverlayDot[] = [];
      const addDots = (lm: NormalizedLandmark[] | null, hand: "left" | "right") => {
        if (!lm) return;
        [0, 4, 8, 12, 16, 20].forEach((i) => {
          if (lm[i]) dots.push({ x: (1 - lm[i].x) * 100, y: lm[i].y * 100, hand });
        });
      };
      addDots(data.left, "left");
      addDots(data.right, "right");
      setHandDots(dots);
    });

    return () => { tracker.stopCamera(); tracker.stopTracking(); };
  }, []);

  // ── KO sync ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (gameState.knockedDown === "player") sceneRef.current?.setPlayerKO(true);
    if (gameState.knockedDown === "ai")     sceneRef.current?.setAIKO(true);
    if (gameState.phase === "countdown" || gameState.phase === "fighting") {
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    }
  }, [gameState.knockedDown, gameState.phase]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSetupCamera = useCallback(async () => {
    const engine  = engineRef.current;
    const tracker = trackerRef.current;
    if (!engine || !tracker || !webcamRef.current) return;

    engine.startCameraSetup();
    setCameraError(null);
    setCameraReady(false);
    setTrackingReady(false);
    setBothHandsVisible(false);

    try {
      const trackerInit = tracker.init().then(() => setTrackingReady(true));
      await tracker.startCamera(webcamRef.current);
      setCameraReady(true);
      await trackerInit;
      tracker.startTracking();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera error";
      setCameraError(
        msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")
          ? "Camera permission denied. Please allow camera access and try again."
          : `Camera setup failed: ${msg}`
      );
    }
  }, []);

  // FIGHT button → show "raise fists" gate, then auto-start
  const handleFightClick = useCallback(() => {
    setReadyCheck(true);
  }, []);

  // Skip the fists check and go straight to countdown
  const handleSkipReadyCheck = useCallback(() => {
    setReadyCheck(false);
    engineRef.current?.startMatch();
    sceneRef.current?.setPlayerKO(false);
    sceneRef.current?.setAIKO(false);
  }, []);

  const handleStartTutorial = useCallback(() => {
    engineRef.current?.startTutorial();
  }, []);

  const handleAdvanceTutorial = useCallback(() => {
    const state = engineRef.current?.getState();
    if (!state) return;
    if (state.tutorialStep >= 4) {
      // Tutorial complete → ready check then fight
      setReadyCheck(true);
    } else {
      engineRef.current?.advanceTutorial();
    }
  }, []);

  const handleSkipTutorial = useCallback(() => {
    handleSkipReadyCheck();
  }, [handleSkipReadyCheck]);

  const handleRestart = useCallback(() => {
    setReadyCheck(false);
    engineRef.current?.reset();
    // Camera is already running — skip back to camera-setup, not start screen
    engineRef.current?.startCameraSetup();
    sceneRef.current?.setPlayerKO(false);
    sceneRef.current?.setAIKO(false);
  }, []);

  // ── Derived flags ─────────────────────────────────────────────────────────
  // Don't show start screen once readyCheck is active (fight/tutorial chose their path)
  const showStart    = (gameState.phase === "start" || gameState.phase === "camera-setup") && !readyCheck;
  const showTutorial = gameState.phase === "tutorial" && !readyCheck;
  const showHUD      = ["fighting", "knockdown", "round-end"].includes(gameState.phase);
  const showWebcam   = gameState.phase !== "start";

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden ${shakeClass}`}
      style={{ background: "#0a0a14" }}
    >
      {/* Game canvas */}
      <canvas
        ref={gameCanvasRef}
        data-testid="canvas-game"
        className="absolute inset-0 w-full h-full"
        style={{ display: "block" }}
      />

      {/* HUD */}
      {showHUD && <HUD state={gameState} />}

      {/* Round / countdown / KO / game-over */}
      <RoundOverlay state={gameState} onRestart={handleRestart} />

      {/* Tutorial */}
      {showTutorial && (
        <TutorialScreen
          step={gameState.tutorialStep}
          bothHandsVisible={bothHandsVisible}
          lastPunchType={gameState.lastPunchType}
          lastPunchTs={gameState.lastPunchTs}
          isBlocking={gameState.isPlayerBlocking}
          onAdvance={handleAdvanceTutorial}
          onSkip={handleSkipTutorial}
        />
      )}

      {/* "Raise both fists" gate — shown after clicking FIGHT or finishing tutorial */}
      {readyCheck && !showTutorial && (
        <ReadyCheckOverlay
          bothHandsVisible={bothHandsVisible}
          onSkip={handleSkipReadyCheck}
        />
      )}

      {/* Start / camera-setup */}
      {showStart && (
        <StartScreen
          phase={gameState.phase as "start" | "camera-setup"}
          onSetupCamera={handleSetupCamera}
          onStart={handleFightClick}
          onTutorial={handleStartTutorial}
          cameraReady={cameraReady}
          trackingReady={trackingReady}
          cameraError={cameraError}
          bothHandsVisible={bothHandsVisible}
        />
      )}

      {/* Webcam preview */}
      <div
        className="absolute z-20"
        style={{
          bottom: 16,
          left: 16,
          width: 160,
          height: 120,
          borderRadius: 10,
          overflow: "hidden",
          border: bothHandsVisible
            ? "2px solid rgba(34,197,94,0.7)"
            : "2px solid rgba(74,144,255,0.4)",
          boxShadow: bothHandsVisible
            ? "0 0 14px rgba(34,197,94,0.4)"
            : "0 0 10px rgba(74,144,255,0.25)",
          display: showWebcam ? "block" : "none",
          transition: "border-color 0.3s, box-shadow 0.3s",
        }}
      >
        <video
          ref={webcamRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          data-testid="video-webcam"
        />
        {/* Hand tracking dots */}
        <div className="absolute inset-0 pointer-events-none">
          {handDots.map((dot, i) => (
            <div
              key={i}
              className="hand-dot"
              style={{
                left: `${dot.x}%`,
                top: `${dot.y}%`,
                background: dot.hand === "left" ? "#4a90ff" : "#ff4a17",
                boxShadow: `0 0 4px ${dot.hand === "left" ? "#4a90ff" : "#ff4a17"}`,
              }}
            />
          ))}
        </div>
        <div
          className="absolute bottom-1 left-0 right-0 text-center font-bold"
          style={{
            fontSize: 9,
            letterSpacing: 2,
            color: bothHandsVisible ? "#22c55e" : "#4a90ffaa",
          }}
        >
          {bothHandsVisible ? "✓ FISTS READY" : "YOU"}
        </div>
      </div>
    </div>
  );
}
