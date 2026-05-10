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
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

interface HandOverlayDot {
  x: number;
  y: number;
  hand: "left" | "right";
}

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
    knockedOut: null,
    winner: null,
    countdownValue: 3,
    isPlayerBlocking: false,
    isAIBlocking: false,
    lastPunchInfo: "",
    comboCount: 0,
  });

  const [cameraReady, setCameraReady] = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [handDots, setHandDots] = useState<HandOverlayDot[]>([]);

  // Initialize scene (3D or 2D fallback)
  useEffect(() => {
    const canvas = gameCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Set canvas size to fill container
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

  // Initialize game engine
  useEffect(() => {
    const engine = new GameEngine();
    engine.onState(setGameState);
    engine.onHit((target) => {
      if (target === "ai") sceneRef.current?.triggerAIHit();
      else sceneRef.current?.triggerPlayerHit();
    });
    engine.setAIPunchCallback((hand) => {
      sceneRef.current?.triggerAIPunch(hand);
    });
    engineRef.current = engine;
    return () => engine.reset();
  }, []);

  // Initialize hand tracker + punch detector
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

      // Build overlay dots for key landmarks
      const dots: HandOverlayDot[] = [];
      const addDots = (
        landmarks: NormalizedLandmark[] | null,
        hand: "left" | "right"
      ) => {
        if (!landmarks) return;
        [0, 4, 8, 12, 16, 20].forEach((i) => {
          if (landmarks[i]) {
            dots.push({
              x: (1 - landmarks[i].x) * 100,
              y: landmarks[i].y * 100,
              hand,
            });
          }
        });
      };
      addDots(data.left, "left");
      addDots(data.right, "right");
      setHandDots(dots);
    });

    return () => {
      tracker.stopCamera();
      tracker.stopTracking();
    };
  }, []);

  const handleSetupCamera = useCallback(async () => {
    const engine = engineRef.current;
    const tracker = trackerRef.current;
    if (!engine || !tracker || !webcamRef.current) return;

    engine.startCameraSetup();
    setCameraError(null);
    setCameraReady(false);
    setTrackingReady(false);

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

  const handleRestart = useCallback(() => {
    engineRef.current?.reset();
    sceneRef.current?.setPlayerKO(false);
    sceneRef.current?.setAIKO(false);
  }, []);

  // Sync KO state to scene
  useEffect(() => {
    if (gameState.knockedOut === "player") sceneRef.current?.setPlayerKO(true);
    if (gameState.knockedOut === "ai") sceneRef.current?.setAIKO(true);
    if (gameState.phase === "countdown") {
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    }
  }, [gameState.knockedOut, gameState.phase]);

  const showStart =
    gameState.phase === "start" || gameState.phase === "camera-setup";
  const showHUD =
    gameState.phase === "fighting" || gameState.phase === "round-end";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ background: "#0a0a14" }}
    >
      {/* Game canvas (3D WebGL or 2D fallback) */}
      <canvas
        ref={gameCanvasRef}
        data-testid="canvas-game"
        className="absolute inset-0 w-full h-full"
        style={{ display: "block" }}
      />

      {/* HUD overlay */}
      {showHUD && <HUD state={gameState} />}

      {/* Round / countdown / KO / game-over overlays */}
      <RoundOverlay state={gameState} onRestart={handleRestart} />

      {/* Start & camera setup screens */}
      {showStart && (
        <StartScreen
          phase={gameState.phase as "start" | "camera-setup"}
          onSetupCamera={handleSetupCamera}
          onStart={handleStartMatch}
          cameraReady={cameraReady}
          trackingReady={trackingReady}
          cameraError={cameraError}
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
          borderRadius: 8,
          overflow: "hidden",
          border: "2px solid rgba(74,144,255,0.5)",
          boxShadow: "0 0 12px rgba(74,144,255,0.3)",
          display: gameState.phase === "start" ? "none" : "block",
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
        {/* Hand tracking dot overlay */}
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
          style={{ color: "#4a90ff", letterSpacing: 2 }}
        >
          YOU
        </div>
      </div>
    </div>
  );
}
