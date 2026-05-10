# Fist Fight — 3D Webcam Boxing Game

A browser-based 3D boxing game where the player fights a CPU opponent using real-time hand tracking from their webcam. Punches are detected via MediaPipe hand landmarks and mapped directly to in-game boxer moves.

## Run & Operate

- `pnpm --filter @workspace/boxing-game run dev` — run the game (port 24201)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000, unused by game)
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- 3D Rendering: Three.js 0.184 (WebGL, with 2D canvas fallback)
- Hand Tracking: MediaPipe Tasks Vision (HandLandmarker)
- Styling: Tailwind CSS v4

## Where things live

- `artifacts/boxing-game/src/game/` — core game modules
  - `HandTracker.ts` — MediaPipe webcam hand landmark detection
  - `PunchDetector.ts` — velocity-based jab/hook/uppercut/block detection
  - `ThreeScene.ts` — Three.js 3D arena, fighters, lighting, animations
  - `Scene2D.ts` — 2D canvas fallback renderer (for environments without WebGL)
  - `SceneManager.ts` — auto-selects 3D or 2D renderer based on WebGL availability
  - `GameEngine.ts` — game loop, round/health management, AI opponent, combo tracking
- `artifacts/boxing-game/src/components/` — React UI
  - `GameCanvas.tsx` — main component orchestrating all systems
  - `HUD.tsx` — health bars, timer, combo counter
  - `StartScreen.tsx` — welcome + camera setup
  - `RoundOverlay.tsx` — countdown, KO, round-end, game-over screens

## Architecture decisions

- **SceneManager auto-selects renderer**: WebGL availability is tested on a throw-away canvas to avoid consuming the game canvas context. Falls back to a 2D canvas renderer automatically.
- **MediaPipe labels are mirrored for selfie camera**: MediaPipe's "Left" hand label = user's right hand on a front-facing camera, so labels are swapped in HandTracker.
- **Velocity-based punch detection**: PunchDetector maintains 8-frame wrist position history and computes velocity vectors. Threshold of 0.018 normalized units/ms avoids false positives from natural hand drift.
- **AI punches on a random timer**: AI opponent fires punches every 1.5–3.5 seconds with random hand selection and punch type to feel unpredictable.
- **Three.js deprecations suppressed**: Using PCFShadowMap (not PCFSoftShadowMap), failIfMajorPerformanceCaveat: false to avoid console noise.

## Product

- Start screen with gameplay instructions
- Camera setup page with model loading status indicators
- 3-round match (60 seconds per round) vs CPU opponent
- Real-time punch detection: jab (upward motion), hook (sideways), uppercut (downward)
- Both hands raised = block (75% damage reduction)
- Punch force proportional to hand velocity (faster = more damage)
- Combo counter with 1.5s timeout
- Knockout detection + round win tracking
- Full 3D arena with boxing ring, ropes, crowd, fighter models
- Webcam preview with hand-tracking dot overlay in corner
- Game-over screen with fight-again option

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The Replit preview sandbox lacks GPU access so Three.js WebGL initialization fails there. The 2D fallback renderer kicks in automatically. Users opening the app in Chrome/Firefox get the full 3D experience.
- MediaPipe WASM files are loaded from CDN at runtime (not bundled). First camera setup takes ~3-5 seconds while the model downloads.
- `pnpm --filter @workspace/db run push` requires DATABASE_URL but the boxing game has no DB dependency.
