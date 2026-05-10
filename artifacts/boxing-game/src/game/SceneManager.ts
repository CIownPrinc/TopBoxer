import { ThreeScene } from "./ThreeScene";
import { Scene2D } from "./Scene2D";

export interface IScene {
  triggerPlayerPunch(hand: "left" | "right"): void;
  triggerAIPunch(hand: "left" | "right"): void;
  triggerPlayerHit(): void;
  triggerAIHit(): void;
  setPlayerKO(v: boolean): void;
  setAIKO(v: boolean): void;
  startRendering(): void;
  stopRendering(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

/** Check WebGL availability on a throw-away canvas — does NOT touch the game canvas */
function supportsWebGL(): boolean {
  try {
    const test = document.createElement("canvas");
    const ctx =
      test.getContext("webgl2") ||
      test.getContext("webgl") ||
      test.getContext("experimental-webgl");
    return !!ctx;
  } catch {
    return false;
  }
}

export function createScene(canvas: HTMLCanvasElement): IScene {
  if (supportsWebGL()) {
    try {
      const scene = new ThreeScene();
      scene.init(canvas);
      return scene;
    } catch {
      // WebGL available but Three.js init failed — fall through to 2D
    }
  }

  // Fallback: plain 2D canvas renderer
  const scene2d = new Scene2D();
  scene2d.init(canvas);
  return scene2d;
}
