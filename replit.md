# Fist Fight — 3D Webcam Boxing Game

A browser-based 3D boxing game where the player fights a CPU opponent using real-time hand tracking from their webcam. Punches are detected via MediaPipe hand landmarks and mapped directly to in-game boxer moves.

## Run & Operate

- `pnpm --filter @workspace/boxing-game run dev` — run the game (port 24201)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000, unused by game)
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- 3D Rendering: Three.js 0.184 (WebGL, with rich 2D canvas fallback)
- Hand Tracking: MediaPipe Tasks Vision (HandLandmarker)
- Styling: Tailwind CSS v4

## Where things live

- `artifacts/boxing-game/src/game/` — core game modules
  - `HandTracker.ts` — MediaPipe webcam hand landmark detection
  - `PunchDetector.ts` — velocity-based jab/hook/uppercut/block detection
  - `ThreeScene.ts` — Three.js 3D arena, fighters, lighting, camera shake
  - `Scene2D.ts` — Rich 2D canvas fallback renderer (crowd, atmosphere, detailed fighters)
  - `SceneManager.ts` — auto-selects 3D or 2D renderer based on WebGL availability
  - `GameEngine.ts` — game loop, real boxing rules, AI opponent, combo tracking
- `artifacts/boxing-game/src/components/` — React UI
  - `GameCanvas.tsx` — main component orchestrating all systems
  - `HUD.tsx` — health bars, timer, combo, power-shot flash, 8-count overlay, low-HP vignette
  - `StartScreen.tsx` — welcome screen with "show both fists" gate before fight
  - `TutorialScreen.tsx` — interactive step-by-step tutorial (jab, hook, block)
  - `RoundOverlay.tsx` — countdown, KO/TKO, round-end, game-over screens

## Architecture decisions

- **SceneManager auto-selects renderer**: WebGL availability is tested on a throw-away canvas to avoid consuming the game canvas context. Falls back to a 2D canvas renderer automatically.
- **MediaPipe labels are mirrored for selfie camera**: MediaPipe's "Left" hand label = user's right hand on a front-facing camera, so labels are swapped in HandTracker.
- **Calibrated velocity thresholds**: VELOCITY_THRESHOLD = 0.28 (units/sec) + MIN_TRAVEL = 0.04 (4% of frame width) eliminates false positives from natural hand tremor. Real punches register at ≥0.4 u/s.
- **AI punches on a random timer**: AI opponent fires punches every 1.8–4 seconds with random hand selection and punch type.
- **Three-knockdown rule**: Health reaching 0 triggers a knockdown, not an immediate KO. Referee does an 8→10 count (3 seconds). Fighters get up with 28% health. 3 knockdowns = TKO.
- **Camera shake**: PlayerHit events trigger CSS shake animation (sm/md/lg based on force). ThreeScene also jiggles the camera position proportional to hit force.
- **Low HP visuals**: Red radial vignette appears below 55% HP, pulses at <28%, goes critical at <14%.

## Product

- Polished arcade start screen with 2D arena behind it
- Camera setup screen with "show both fists" gate — fight button locked until both hands detected
- Interactive tutorial: show hands → jab → hook → block → ready
- 3-round match (60 seconds per round) vs CPU opponent
- Real-time punch detection: jab (upward), hook (horizontal), uppercut (downward)
- Both hands raised above face = block (80% damage reduction)
- Punch force proportional to hand velocity (faster = more damage)
- Combo counter with 1.5s timeout
- **Real boxing rules**: Three-knockdown TKO, 8-count referee mechanic, partial health on getup
- Camera shake on being hit (magnitude proportional to punch force)
- Red vignette & pulsing danger effect at low HP
- Power-shot overlay flash for hard hits (force ≥ 0.55)
- KO/TKO slam animation, round-end scoring, best-of-3 match
- Webcam preview with hand-tracking dot overlay (turns green when both hands detected)
- Full 3D arena with boxing ring, ropes, crowd, fighter models (WebGL)
- Rich 2D fallback with detailed fighters, atmospheric lighting, crowd (no WebGL)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The Replit preview sandbox lacks GPU access so Three.js WebGL initialization fails. The 2D fallback renderer kicks in automatically. Users opening the app in Chrome/Firefox get the full 3D experience.
- MediaPipe WASM files are loaded from CDN at runtime (not bundled). First camera setup takes ~3-5 seconds while the model downloads.
- Punch detection requires 4%+ of frame width travel distance AND 0.28+ u/s velocity to avoid false positives from natural hand movement.
