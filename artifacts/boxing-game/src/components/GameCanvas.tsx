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

export function GameCanvas() {
  const gameCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const trackerRef = useRef<HandTracker | null>(null);
  const detectorRef = useRef<PunchDetector | null>(null);
  const sceneRef = useRef<IScene | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

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

  const [cameraReady, setCameraReady] = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [handDots, setHandDots] = useState<HandOverlayDot[]>([]);
  const [bothHandsVisible, setBothHandsVisible] = useState(false);
  const [shakeClass, setShakeClass] = useState<ShakeLevel>("");
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scene init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = gameCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const scene = createScene(canvas);
    scene.startRendering();
    sceneRef.current = scene;

    const handleResize = () => {
      if (!container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      scene.resize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      scene.dispose();
    };
  }, []);

  // ── Camera shake helper ─────────────────────────────────────────────────────
  const triggerShake = useCallback((force: number) => {
    const level: ShakeLevel =
      force >= 0.85 ? "shake-lg" : force >= 0.55 ? "shake-md" : "shake-sm";
    setShakeClass(level);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShakeClass(""), 600);
  }, []);

  // ── Game engine ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const engine = new GameEngine();
    engine.onState(setGameState);
    engine.onHit((target, force) => {
      if (target === "ai") sceneRef.current?.triggerAIHit();
      else {
        sceneRef.current?.triggerPlayerHit();
        triggerShake(force);
      }
    });
    engine.setAIPunchCallback((hand) => sceneRef.current?.triggerAIPunch(hand));
    engineRef.current = engine;
    return () => engine.reset();
  }, [triggerShake]);

  // ── Hand tracker + punch detector ───────────────────────────────────────────
  useEffect(() => {
    const tracker = new HandTracker();
    const detector = new PunchDetector();
    trackerRef.current = tracker;
    detectorRef.current = detector;

    detector.onPunch((event) => {
      engineRef.current?.playerPunch(event);
      sceneRef.current?.triggerPlayerPunch(event.hand);
    });

    tracker.onTrack((data) => {
      detector.update(data.left, data.right);
      engineRef.current?.setPlayerBlocking(detector.isBlocking());
      setBothHandsVisible(detector.getBothHandsVisible());

      // Overlay dots for webcam preview
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

  // ── KO / knockdown sync to scene ────────────────────────────────────────────
  useEffect(() => {
    if (gameState.knockedDown === "player") sceneRef.current?.setPlayerKO(true);
    if (gameState.knockedDown === "ai") sceneRef.current?.setAIKO(true);
    if (gameState.phase === "countdown" || gameState.phase === "fighting") {
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    }
  }, [gameState.knockedDown, gameState.phase]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSetupCamera = useCallback(async () => {
    const engine = engineRef.current;
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

  const handleStartMatch = useCallback(() => {
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
      // Last step done → start the match
      engineRef.current?.startMatch();
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    } else {
      engineRef.current?.advanceTutorial();
    }
  }, []);

  const handleSkipTutorial = useCallback(() => {
    handleStartMatch();
  }, [handleStartMatch]);

  const handleRestart = useCallback(() => {
    engineRef.current?.reset();
    sceneRef.current?.setPlayerKO(false);
    sceneRef.current?.setAIKO(false);
  }, []);

  // ── Derived display flags ───────────────────────────────────────────────────
  const showStart = gameState.phase === "start" || gameState.phase === "camera-setup";
  const showTutorial = gameState.phase === "tutorial";
  const showHUD = ["fighting", "knockdown", "round-end"].includes(gameState.phase);
  const showWebcam = gameState.phase !== "start";

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

      {/* Round / countdown / KO / game-over overlays */}
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

      {/* Start / camera setup */}
      {showStart && (
        <StartScreen
          phase={gameState.phase as "start" | "camera-setup"}
          onSetupCamera={handleSetupCamera}
          onStart={handleStartMatch}
          onTutorial={handleStartTutorial}
          cameraReady={cameraReady}
          trackingReady={trackingReady}
          cameraError={cameraError}
          bothHandsVisible={bothHandsVisible}
        />
      )}

      {/* Webcam preview (bottom-left) */}
      <div
        className="absolute z-20"
        style={{
          bottom: 16,
          left: 16,
          width: 160,
          height: 120,
          borderRadius: 8,
          overflow: "hidden",
          border: bothHandsVisible
            ? "2px solid rgba(34,197,94,0.7)"
            : "2px solid rgba(74,144,255,0.5)",
          boxShadow: bothHandsVisible
            ? "0 0 12px rgba(34,197,94,0.4)"
            : "0 0 12px rgba(74,144,255,0.3)",
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
          className="absolute bottom-1 left-0 right-0 text-center text-xs font-bold"
          style={{
            color: bothHandsVisible ? "#22c55e" : "#4a90ff",
            letterSpacing: 2,
          }}
        >
          {bothHandsVisible ? "✓ READY" : "YOU"}
        </div>
      </div>
    </div>
  );
}
