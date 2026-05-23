import { useEffect, useRef, useState, useCallback } from "react";
import type { HandDebugInfo } from "../game/PunchDetector";
import { BoxingInputSystem } from "../input";
import { createScene } from "../game/SceneManager";
import type { IScene } from "../game/SceneManager";
import { GameEngine } from "../game/GameEngine";
import type { GameState } from "../game/GameEngine";
import { HUD } from "./HUD";
import { StartScreen } from "./StartScreen";
import { RoundOverlay } from "./RoundOverlay";
import { TutorialScreen } from "./TutorialScreen";
import { DebugOverlay } from "./DebugOverlay";

interface HandOverlayDot { x: number; y: number; hand: "left" | "right" }
type ShakeLevel = "" | "shake-sm" | "shake-md" | "shake-lg";

const EMPTY_DEBUG: HandDebugInfo = {
  state: "idle", speed: 0, vel: { x: 0, y: 0, z: 0 },
  lastGesture: "idle", confidence: 0, blocking: false,
  pos: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 }, stability: 1, trackingConfidence: 0,
};

// ── Ready-check overlay ────────────────────────────────────────────────────────
function ReadyCheckOverlay({
  bothHandsVisible,
  onSkip,
}: { bothHandsVisible: boolean; onSkip: () => void }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)", zIndex: 30 }}
    >
      <div className="text-center px-8 max-w-sm">
        <div
          className="font-black mb-4 transition-colors duration-300"
          style={{
            fontFamily: "monospace",
            fontSize: 44,
            letterSpacing: 4,
            color: bothHandsVisible ? "#22c55e" : "#fff",
            textShadow: bothHandsVisible ? "0 0 20px #22c55e" : undefined,
          }}
        >
          {bothHandsVisible ? "✊ READY! ✊" : "✊ GET READY ✊"}
        </div>
        <p className="text-sm mb-8" style={{ color: "rgba(255,255,255,0.45)", lineHeight: 1.7 }}>
          {bothHandsVisible
            ? "Starting countdown…"
            : "Raise both fists in front of the camera to begin."}
        </p>
        <div className="flex justify-center gap-8 mb-8">
          {["Left fist", "Right fist"].map((label) => (
            <div key={label} className="text-center">
              <div
                style={{
                  width: 52, height: 52, borderRadius: "50%",
                  border: `3px solid ${bothHandsVisible ? "#22c55e" : "rgba(255,255,255,0.18)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24, margin: "0 auto 8px",
                  background: bothHandsVisible ? "rgba(34,197,94,0.15)" : "transparent",
                  boxShadow: bothHandsVisible ? "0 0 14px rgba(34,197,94,0.5)" : "none",
                  transition: "all 0.3s",
                }}
              >✊</div>
              <div className="text-xs" style={{ color: bothHandsVisible ? "#22c55e" : "rgba(255,255,255,0.3)" }}>
                {label}
              </div>
            </div>
          ))}
        </div>
        {!bothHandsVisible && (
          <div
            className="step-glow inline-block px-5 py-2 rounded-lg text-sm font-bold mb-4"
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
          style={{
            color: "rgba(255,255,255,0.22)", background: "none", border: "none",
            cursor: "pointer", fontSize: 12, marginTop: 12,
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
  const webcamRef     = useRef<HTMLVideoElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);

  const inputRef    = useRef<BoxingInputSystem | null>(null);
  const sceneRef    = useRef<IScene | null>(null);
  const engineRef   = useRef<GameEngine | null>(null);

  // Track whether we've triggered the FP transition in this match
  const fpTriggeredRef = useRef(false);

  const [gameState, setGameState] = useState<GameState>({
    phase: "start", round: 1, maxRounds: 3,
    playerHealth: 100, aiHealth: 100, timeLeft: 60,
    roundsWon: { player: 0, ai: 0 },
    knockedDown: null, knockdownCount: { player: 0, ai: 0 }, eightCount: 8,
    winner: null, countdownValue: 3,
    isPlayerBlocking: false, isAIBlocking: false,
    lastPunchType: null, lastPunchForce: 0, lastPunchTs: 0,
    comboCount: 0, tutorialStep: 0,
    opponentArchetype: "balanced", opponentTier: "early", trophies: 0, streak: 0, trackingQuality: 0,
    playerStamina: 100,
    aiStamina: 100,
    playerExhausted: false,
    aiExhausted: false,
    playerCombatState: "idle",
    aiCombatState: "idle",
    playerStunEndTs: 0,
    aiStunEndTs: 0,
    playerDodgeEndTs: 0,
    playerDodgeIFrameEndTs: 0,
  });

  const [cameraReady, setCameraReady]     = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [cameraError, setCameraError]     = useState<string | null>(null);
  const [handDots, setHandDots]           = useState<HandOverlayDot[]>([]);
  const [bothHandsVisible, setBothHandsVisible] = useState(false);
  const [shakeClass, setShakeClass]       = useState<ShakeLevel>("");
  const [readyCheck, setReadyCheck]       = useState(false);
  const [showDebug, setShowDebug]         = useState(false);
  const [debugInfo, setDebugInfo]         = useState<{ left: HandDebugInfo; right: HandDebugInfo }>({
    left: EMPTY_DEBUG, right: EMPTY_DEBUG,
  });
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── D key toggles debug overlay ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") setShowDebug((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Auto-advance ready-check when both hands visible ─────────────────────
  useEffect(() => {
    if (!readyCheck || !bothHandsVisible) return;
    const t = setTimeout(() => {
      setReadyCheck(false);
      engineRef.current?.startMatch();
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    }, 600);
    return () => clearTimeout(t);
  }, [readyCheck, bothHandsVisible]);

  // ── Referee-led first-person transition before combat ───────────────────────
  useEffect(() => {
    if (gameState.phase !== "camera-transition") return;
    if (fpTriggeredRef.current) return;
    sceneRef.current?.transitionToFirstPerson();
    fpTriggeredRef.current = true;
    const t = setTimeout(() => {
      engineRef.current?.beginCombatAfterTransition();
    }, 2700);
    return () => clearTimeout(t);
  }, [gameState.phase, gameState.round]);

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
    const onResize = () => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
      scene.resize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); scene.dispose(); };
  }, []);

  // ── Camera shake (CSS) ────────────────────────────────────────────────────
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
      if (target === "ai") {
        sceneRef.current?.triggerAIHit(force);
      } else {
        sceneRef.current?.triggerPlayerHit(force);
        triggerShake(force);
      }
    });
    engine.setAIPunchCallback((hand) => sceneRef.current?.triggerAIPunch(hand));
    engineRef.current = engine;
    return () => engine.reset();
  }, [triggerShake]);

  // ── Professional webcam boxing input runtime ─────────────────────────────
  useEffect(() => {
    const input = new BoxingInputSystem();
    inputRef.current = input;

    input.onInputEvent((event) => {
      engineRef.current?.playerPunch(event);
      sceneRef.current?.triggerPlayerPunch(event.hand);
    });

    input.onFrame((snapshot) => {
      const left = snapshot.motion?.hands.left?.landmarks ?? null;
      const right = snapshot.motion?.hands.right?.landmarks ?? null;
      engineRef.current?.setPlayerBlocking(snapshot.isBlocking);
      sceneRef.current?.setPlayerBlocking(snapshot.isBlocking);
      sceneRef.current?.updatePlayerHands(left, right, snapshot.leftState, snapshot.rightState);
      engineRef.current?.setPlayerTrackingSignal({
        confidence: snapshot.motion?.trackingConfidence ?? 0,
        speed: Math.max(snapshot.leftDebug.speed, snapshot.rightDebug.speed),
        blocking: snapshot.isBlocking,
      });
      
      // Integrate new dynamic dodge handling here!
      if (snapshot.dodge) {
        engineRef.current?.playerDodge(snapshot.dodge);
      }
    });

    input.onDiagnostics((snapshot) => {
      setBothHandsVisible(snapshot.bothHandsVisible);
      setDebugInfo({ left: snapshot.leftDebug, right: snapshot.rightDebug });
      setHandDots(input.getHandDots());
    });

    return () => input.dispose();
  }, []);


  // Pause tracking when tab is hidden to improve perf/stability
  useEffect(() => {
    const onVisibility = () => {
      const input = inputRef.current;
      if (!input) return;
      if (document.hidden) input.stopTracking();
      else if (cameraReady && trackingReady) input.startTracking();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [cameraReady, trackingReady]);
  // ── KO, Stun & Exhaustion sync to scene ───────────────────────────────────
  useEffect(() => {
    if (gameState.knockedDown === "player") sceneRef.current?.setPlayerKO(true);
    if (gameState.knockedDown === "ai")     sceneRef.current?.setAIKO(true);
    if (["referee-start", "camera-transition", "fighting"].includes(gameState.phase)) {
      sceneRef.current?.setPlayerKO(false);
      sceneRef.current?.setAIKO(false);
    }

    const scene = sceneRef.current;
    if (scene) {
      if (typeof (scene as any).setPlayerExhausted === "function") {
        (scene as any).setPlayerExhausted(gameState.playerExhausted);
      }
      if (typeof (scene as any).setAIExhausted === "function") {
        (scene as any).setAIExhausted(gameState.aiExhausted);
      }
      if (typeof (scene as any).setPlayerStunned === "function") {
        (scene as any).setPlayerStunned(gameState.playerCombatState === "stunned");
      }
      if (typeof (scene as any).setAIStunned === "function") {
        (scene as any).setAIStunned(gameState.aiCombatState === "stunned");
      }
    }
  }, [
    gameState.knockedDown,
    gameState.phase,
    gameState.playerExhausted,
    gameState.aiExhausted,
    gameState.playerCombatState,
    gameState.aiCombatState,
  ]);

  useEffect(() => {
    if (gameState.phase === "referee-start") sceneRef.current?.setRefereeState("counting");
    else if (gameState.phase === "camera-transition") sceneRef.current?.setRefereeState("fight");
    else sceneRef.current?.setRefereeState("idle");
  }, [gameState.phase]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSetupCamera = useCallback(async () => {
    const engine  = engineRef.current;
    const input = inputRef.current;
    if (!engine || !input || !webcamRef.current) return;
    engine.startCameraSetup();
    setCameraError(null);
    setCameraReady(false);
    setTrackingReady(false);
    setBothHandsVisible(false);
    try {
      const inputInit = input.init().then(() => setTrackingReady(true));
      await input.startCamera(webcamRef.current);
      setCameraReady(true);
      await inputInit;
      input.startCalibration();
      input.startTracking();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera error";
      setCameraError(
        msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")
          ? "Camera permission denied. Please allow camera access and try again."
          : `Camera setup failed: ${msg}`
      );
    }
  }, []);

  const handleFightClick      = useCallback(() => setReadyCheck(true), []);
  const handleSkipReadyCheck  = useCallback(() => {
    setReadyCheck(false);
    engineRef.current?.startMatch();
    sceneRef.current?.setPlayerKO(false);
    sceneRef.current?.setAIKO(false);
  }, []);

  const handleStartTutorial   = useCallback(() => engineRef.current?.startTutorial(), []);
  const handleAdvanceTutorial = useCallback(() => {
    const state = engineRef.current?.getState();
    if (!state) return;
    if (state.tutorialStep >= 4) setReadyCheck(true);
    else engineRef.current?.advanceTutorial();
  }, []);

  const handleRestart = useCallback(() => {
    // Reset FP camera and trigger flag
    fpTriggeredRef.current = false;
    sceneRef.current?.resetCamera();
    setReadyCheck(false);
    engineRef.current?.reset();
    engineRef.current?.startCameraSetup();
    sceneRef.current?.setPlayerKO(false);
    sceneRef.current?.setAIKO(false);
  }, []);

  // ── Derived flags ─────────────────────────────────────────────────────────
  const showStart    = (gameState.phase === "start" || gameState.phase === "camera-setup") && !readyCheck;
  const showTutorial = gameState.phase === "tutorial" && !readyCheck;
  const showHUD      = ["fighting", "knockdown", "round-end"].includes(gameState.phase);
  const showWebcam   = gameState.phase !== "start";
  const showDebugHint = showWebcam && !showStart && !readyCheck && !showTutorial;

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

      {/* Round / KO / game-over overlays */}
      <RoundOverlay state={gameState} onRestart={handleRestart} />

      {/* Tutorial */}
      {showTutorial && (
        <TutorialScreen
          step={gameState.tutorialStep}
          bothHandsVisible={bothHandsVisible}
          lastPunchType={gameState.lastPunchType}
          lastPunchTs={gameState.lastPunchTs}
          isBlocking={gameState.isPlayerBlocking}
          leftDebug={debugInfo.left}
          rightDebug={debugInfo.right}
          onAdvance={handleAdvanceTutorial}
          onSkip={handleSkipReadyCheck}
        />
      )}

      {/* Ready-check gate */}
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

      {/* Debug overlay */}
      {showDebug && (
        <DebugOverlay
          left={debugInfo.left}
          right={debugInfo.right}
          onClose={() => setShowDebug(false)}
        />
      )}

      {/* Debug toggle hint */}
      {showDebugHint && !showDebug && (
        <button
          onClick={() => setShowDebug(true)}
          style={{
            position: "absolute", bottom: 148, right: 16,
            fontSize: 9, color: "rgba(255,255,255,0.18)",
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 4, padding: "3px 6px",
            cursor: "pointer", zIndex: 21,
            fontFamily: "monospace", letterSpacing: 1,
          }}
        >
          [D] debug
        </button>
      )}

      {/* Webcam preview */}
      <div
        className="absolute z-20"
        style={{
          bottom: 16, left: 16, width: 160, height: 120,
          borderRadius: 10, overflow: "hidden",
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
          autoPlay playsInline muted
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          data-testid="video-webcam"
        />
        <div className="absolute inset-0 pointer-events-none">
          {handDots.map((dot, i) => (
            <div
              key={i}
              className="hand-dot"
              style={{
                left: `${dot.x}%`, top: `${dot.y}%`,
                background: dot.hand === "left" ? "#4a90ff" : "#ff4a17",
                boxShadow: `0 0 4px ${dot.hand === "left" ? "#4a90ff" : "#ff4a17"}`,
              }}
            />
          ))}
        </div>
        <div
          className="absolute bottom-1 left-0 right-0 text-center font-bold"
          style={{ fontSize: 9, letterSpacing: 2, color: bothHandsVisible ? "#22c55e" : "#4a90ffaa" }}
        >
          {bothHandsVisible ? "✓ FISTS READY" : "YOU"}
        </div>
      </div>
    </div>
  );
}
