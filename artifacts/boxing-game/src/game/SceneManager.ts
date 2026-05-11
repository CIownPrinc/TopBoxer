import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandState } from "./PunchDetector";
import { ThreeScene } from "./ThreeScene";
import { Scene2D } from "./Scene2D";

export interface IScene {
  triggerPlayerPunch(hand: "left" | "right"): void;
  triggerAIPunch(hand: "left" | "right"): void;
  triggerPlayerHit(force?: number): void;
  triggerAIHit(force?: number): void;
  setPlayerKO(v: boolean): void;
  setAIKO(v: boolean): void;
  setPlayerBlocking(v: boolean): void;
  startRendering(): void;
  stopRendering(): void;
  resize(w: number, h: number): void;
  dispose(): void;
  transitionToFirstPerson(): void;
  updatePlayerHands(
    left:  NormalizedLandmark[] | null,
    right: NormalizedLandmark[] | null,
    leftState:  HandState,
    rightState: HandState,
  ): void;
  resetCamera(): void;
  setRefereeState(phase: "idle" | "counting" | "fight"): void;
}

function supportsWebGL(): boolean {
  try {
    const t = document.createElement("canvas");
    return !!(t.getContext("webgl2") || t.getContext("webgl") || t.getContext("experimental-webgl"));
  } catch { return false; }
}

/** Returns true if the canvas already has a WebGL context attached */
function hasWebGLContext(canvas: HTMLCanvasElement): boolean {
  try {
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { return false; }
}

export function createScene(canvas: HTMLCanvasElement): IScene {
  if (supportsWebGL()) {
    const three = new ThreeScene();
    try {
      three.init(canvas);
      return three;
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stk = err instanceof Error ? err.stack : "(no stack)";
      console.error("[ThreeScene] init failed:", msg, stk);
      three.dispose();
    }
  }

  // Only fall back to 2D if the canvas does NOT already have a WebGL context
  if (hasWebGLContext(canvas)) {
    console.warn("[SceneManager] Canvas has WebGL context; cannot fall back to 2D. Using no-op scene.");
    return new NoOpScene();
  }

  const s2 = new Scene2D();
  s2.init(canvas);
  return s2;
}

/** Safety valve — if both renderers fail, return a scene that does nothing */
class NoOpScene implements IScene {
  triggerPlayerPunch(_hand: "left" | "right"): void {}
  triggerAIPunch(_hand: "left" | "right"): void {}
  triggerPlayerHit(_force?: number): void {}
  triggerAIHit(_force?: number): void {}
  setPlayerKO(_v: boolean): void {}
  setAIKO(_v: boolean): void {}
  setPlayerBlocking(_v: boolean): void {}
  startRendering(): void {}
  stopRendering(): void {}
  resize(_w: number, _h: number): void {}
  dispose(): void {}
  transitionToFirstPerson(): void {}
  updatePlayerHands(): void {}
  resetCamera(): void {}
  setRefereeState(_phase: "idle" | "counting" | "fight"): void {}
}
