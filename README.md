# TopBoxer

A browser-based webcam boxing game monorepo with a 3D/2D React client, typed API server, and shared API/database libraries.

## Overview

TopBoxer is a pnpm workspace focused on an interactive boxing experience where players use real-time webcam hand tracking to throw punches against a CPU opponent. The repository includes:

- **`@workspace/boxing-game`**: the main game client (React + Vite + Three.js + MediaPipe).
- **`@workspace/api-server`**: a lightweight Express API server (currently includes health endpoints).
- **Shared libraries** for API schema/client generation and database access.

### Core goals

- Deliver a responsive, browser-based boxing game with webcam controls.
- Keep API contracts and runtime validation type-safe across server/client.
- Organize gameplay, server, and shared tooling in a single monorepo.

### Target users / use cases

- Developers extending a webcam/gesture-controlled web game.
- Teams prototyping game + API architecture in a TypeScript monorepo.
- Contributors iterating on gameplay, UI, and backend services together.

## Tech Stack

| Area | Stack |
|---|---|
| Languages | TypeScript, CSS |
| Package management | pnpm workspaces |
| Frontend | React 19, Vite 7, Tailwind CSS 4, Radix UI |
| Game/ML | Three.js, MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) |
| Backend | Node.js, Express 5, Pino |
| Data | PostgreSQL (`pg`), Drizzle ORM, drizzle-kit |
| API contracts | OpenAPI 3.1 (`lib/api-spec`), Orval, Zod |
| Tooling | TypeScript project references, esbuild |

## Requirements / Prerequisites

- **Node.js**: modern version compatible with this repo (assumption: Node 20+; `replit.md` references Node 24).
- **pnpm**: required (install scripts explicitly fail for npm/yarn).
- **PostgreSQL**: required only for packages that initialize DB connections (`api-server`, `lib/db`).
- **OS**: macOS/Linux/WSL recommended (commands use POSIX shell syntax such as `export VAR=... && ...`).
- **Webcam + browser**: required to play boxing game (camera permission needed).

## Installation

1. **Clone the repository**

```bash
git clone <your-repo-url>
cd TopBoxer
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Configure environment variables**

Create a local env file from the example:

```bash
cp .env.example .env
```

Then update values as needed.

4. **Run database setup (if using DB-backed packages)**

> `lib/db/src/schema/index.ts` is currently a starter template with no tables exported, so this step is optional unless you add schema models.

```bash
pnpm --filter @workspace/db run push
```

5. **Start development apps**

Game client:

```bash
PORT=24201 BASE_PATH=/ pnpm --filter @workspace/boxing-game run dev
```

API server:

```bash
PORT=5000 DATABASE_URL=postgres://user:password@localhost:5432/topboxer pnpm --filter @workspace/api-server run dev
```

## Environment Variables

> No `.env.example` existed in the repository before this README update; one has been added.

| Variable | Description | Required | Example |
|---|---|---:|---|
| `PORT` | Port used by `boxing-game` Vite server and `api-server` runtime. | Yes (per process) | `24201` (game), `5000` (api) |
| `BASE_PATH` | Vite `base` path for `boxing-game` asset routing. | Yes (boxing-game) | `/` |
| `DATABASE_URL` | PostgreSQL connection string used by `api-server` and `lib/db`. | Yes (api-server/db) | `postgres://user:pass@localhost:5432/topboxer` |
| `NODE_ENV` | Runtime mode (`development`/`production`), set in some scripts. | Recommended | `development` |
| `REPL_ID` | Replit-specific var that toggles dev plugins in Vite config. | Optional | `your-repl-id` |

## Usage

### Development mode

Run full workspace typechecking:

```bash
pnpm run typecheck
```

Run game locally:

```bash
PORT=24201 BASE_PATH=/ pnpm --filter @workspace/boxing-game run dev
```

Run API server locally:

```bash
PORT=5000 DATABASE_URL=postgres://user:password@localhost:5432/topboxer pnpm --filter @workspace/api-server run dev
```

### Production build / preview

Build all packages that expose `build` scripts:

```bash
pnpm run build
```

Build and preview only the game:

```bash
PORT=24201 BASE_PATH=/ pnpm --filter @workspace/boxing-game run build
PORT=24201 BASE_PATH=/ pnpm --filter @workspace/boxing-game run serve
```

Build and start only the API server:

```bash
pnpm --filter @workspace/api-server run build
PORT=5000 DATABASE_URL=postgres://user:password@localhost:5432/topboxer pnpm --filter @workspace/api-server run start
```

### Important scripts

| Command | Purpose |
|---|---|
| `pnpm run build` | Workspace build (typecheck + package builds where present). |
| `pnpm run typecheck` | Typecheck libs + artifact packages + scripts workspace. |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API clients/schemas from OpenAPI using Orval. |
| `pnpm --filter @workspace/db run push` | Push Drizzle schema to PostgreSQL. |
| `pnpm --filter @workspace/scripts run hello` | Example script runner using `tsx`. |

## Project Structure

```text
.
├── artifacts/
│   ├── boxing-game/        # Main webcam boxing client (React/Vite/Three.js)
│   ├── api-server/         # Express API server
│   └── mockup-sandbox/     # UI sandbox/prototyping app
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval config
│   ├── api-zod/            # Generated/typed Zod API contracts
│   ├── api-client-react/   # React API client wrappers
│   └── db/                 # Drizzle DB setup and schema exports
├── scripts/                # Workspace utility scripts
├── pnpm-workspace.yaml
└── tsconfig*.json
```

## Features

- Real-time webcam hand tracking for gameplay input.
- Punch detection and in-game boxing interactions.
- Automatic 3D rendering path with 2D fallback for non-WebGL environments.
- Typed API contract flow: OpenAPI -> generated Zod/client libraries.
- Monorepo-first developer workflow with shared TypeScript configuration.

## Screenshots / Demo

Existing assets:

- Open Graph image: `artifacts/boxing-game/public/opengraph.jpg`

Suggested README media placeholders (replace with real links):

- **Gameplay GIF**: _TODO: add gif link_
- **Start/tutorial screen screenshot**: _TODO: add image link_
- **3D ring battle screenshot**: _TODO: add image link_

## API Documentation

The API server currently exposes a health endpoint under `/api`.

### Base path

- `/api`

### Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/healthz` | Returns service health status. | None |

### Example request

```bash
curl -s http://localhost:5000/api/healthz
```

### Example response

```json
{
  "status": "ok"
}
```

## Development

### Linting / formatting

- A dedicated lint script is **not currently defined** in workspace `package.json` files.
- Prettier is included as a dev dependency; you can run it manually (assumption):

```bash
pnpm prettier --check .
pnpm prettier --write .
```

### Testing workflow

- There are currently **no explicit automated test scripts** in the workspace packages.
- Use typechecking and local manual verification as baseline quality gates:

```bash
pnpm run typecheck
```

### Contribution setup

1. Install with `pnpm install`.
2. Configure `.env` from `.env.example`.
3. Run the relevant app(s) with package filters.
4. Keep OpenAPI-generated code in sync when changing `lib/api-spec/openapi.yaml`.

### Local development tips

- The game requires `PORT` and `BASE_PATH`; missing values will crash Vite config early.
- The API server requires a valid numeric `PORT` and `DATABASE_URL`.
- First MediaPipe model load may take a few seconds due to CDN fetch.

## Contributing

Recommended workflow:

1. Create a branch from `main` (example: `feature/improve-combat-ai`).
2. Keep changes scoped to one concern.
3. Run `pnpm run typecheck` before opening a PR.
4. Include:
   - what changed,
   - why it changed,
   - how it was tested,
   - any env/config updates.
5. For bugs, open issues with reproduction steps, expected behavior, and logs/screenshots.

## License

This project declares an **MIT** license in the root `package.json`.

> Note: no standalone `LICENSE` file was found in the repository at time of writing.

## Credits

- Built with open-source tooling including React, Vite, Three.js, MediaPipe, Express, Drizzle, Zod, and Orval.
- Workspace scaffolding and conventions appear aligned with Replit-oriented tooling/plugins.

## Troubleshooting

- **`PORT environment variable is required`**: set `PORT` before running `boxing-game` or `api-server`.
- **`BASE_PATH environment variable is required`**: set `BASE_PATH=/` (or your deployment subpath) for the game.
- **`DATABASE_URL must be set`**: provide a PostgreSQL connection string for DB-backed packages.
- **No camera input in game**: check browser camera permissions and ensure HTTPS/localhost context.
- **3D scene not available**: environments without usable WebGL/GPU should fall back to 2D rendering.
