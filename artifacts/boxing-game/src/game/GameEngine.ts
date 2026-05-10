import type { PunchEvent, PunchType } from "./PunchDetector";

export type GamePhase =
  | "start"
  | "camera-setup"
  | "tutorial"
  | "countdown"
  | "fighting"
  | "knockdown"   // 8-count in progress
  | "round-end"
  | "game-over";

export interface GameState {
  phase: GamePhase;
  round: number;
  maxRounds: number;
  playerHealth: number;
  aiHealth: number;
  timeLeft: number;
  roundsWon: { player: number; ai: number };
  // Boxing KO tracking
  knockedDown: "player" | "ai" | null;  // fighter currently being counted
  knockdownCount: { player: number; ai: number }; // knockdowns this round
  eightCount: number;                   // current 8-count value (8→10)
  winner: "player" | "ai" | null;
  countdownValue: number;
  isPlayerBlocking: boolean;
  isAIBlocking: boolean;
  // Feedback
  lastPunchType: PunchType | null;
  lastPunchForce: number;
  lastPunchTs: number;
  comboCount: number;
  // Tutorial
  tutorialStep: number; // 0–4
}

export type StateListener = (state: GameState) => void;
export type HitEvent = (target: "player" | "ai", force: number) => void;

// ─── Constants ────────────────────────────────────────────────────────────────
const ROUND_DURATION = 60;
const COUNTDOWN_DURATION = 3;
const ROUND_END_MS = 4500;
const MAX_HEALTH = 100;
const MAX_ROUNDS = 3;
const MAX_KNOCKDOWNS = 3;   // Three-knockdown rule → TKO
const GETUP_HEALTH = 28;    // health restored when getting up
const EIGHT_COUNT_SECS = 4; // referee counts 8→10 over this many seconds

const BASE_DMG: Record<string, number> = {
  jab: 7,
  hook: 13,
  uppercut: 10,
};
const BLOCK_REDUCTION = 0.2; // only 20% of damage gets through when blocking
// ─────────────────────────────────────────────────────────────────────────────

export class GameEngine {
  private state: GameState = this.defaultState();
  private listeners: StateListener[] = [];
  private hitListeners: HitEvent[] = [];
  private roundTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private eightCountTimer: ReturnType<typeof setInterval> | null = null;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;
  private aiPunchTimer: ReturnType<typeof setTimeout> | null = null;
  private onAIPunchCb: ((hand: "left" | "right") => void) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────
  onState(cb: StateListener): void { this.listeners.push(cb); }
  onHit(cb: HitEvent): void { this.hitListeners.push(cb); }
  setAIPunchCallback(cb: (hand: "left" | "right") => void): void { this.onAIPunchCb = cb; }
  getState(): GameState { return { ...this.state }; }

  startCameraSetup(): void {
    this.state = { ...this.defaultState(), phase: "camera-setup" };
    this.emit();
  }

  startTutorial(): void {
    this.state = { ...this.defaultState(), phase: "tutorial", tutorialStep: 0 };
    this.emit();
  }

  advanceTutorial(): void {
    this.state.tutorialStep++;
    this.emit();
  }

  startMatch(): void {
    this.stopTimers();
    this.state = {
      ...this.defaultState(),
      phase: "countdown",
      roundsWon: { ...this.state.roundsWon }, // preserve cross-round wins
    };
    this.startCountdown();
    this.emit();
  }

  playerPunch(event: PunchEvent): void {
    if (this.state.phase !== "fighting") return;
    this.state.lastPunchType = event.type;
    this.state.lastPunchForce = event.force;
    this.state.lastPunchTs = Date.now();
    this.applyDamage("player", event.type, event.force);

    // Combo tracking
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.state.comboCount++;
    this.comboTimer = setTimeout(() => {
      this.state.comboCount = 0;
      this.emit();
    }, 1500);
  }

  setPlayerBlocking(blocking: boolean): void {
    this.state.isPlayerBlocking = blocking;
  }

  reset(): void {
    this.stopTimers();
    this.state = this.defaultState();
    this.emit();
  }

  // ── Private ─────────────────────────────────────────────────────────────────
  private defaultState(): GameState {
    return {
      phase: "start",
      round: 1,
      maxRounds: MAX_ROUNDS,
      playerHealth: MAX_HEALTH,
      aiHealth: MAX_HEALTH,
      timeLeft: ROUND_DURATION,
      roundsWon: { player: 0, ai: 0 },
      knockedDown: null,
      knockdownCount: { player: 0, ai: 0 },
      eightCount: 8,
      winner: null,
      countdownValue: COUNTDOWN_DURATION,
      isPlayerBlocking: false,
      isAIBlocking: false,
      lastPunchType: null,
      lastPunchForce: 0,
      lastPunchTs: 0,
      comboCount: 0,
      tutorialStep: 0,
    };
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb(this.getState()));
  }

  private startCountdown(): void {
    this.state.countdownValue = COUNTDOWN_DURATION;
    this.emit();
    this.countdownTimer = setInterval(() => {
      this.state.countdownValue--;
      if (this.state.countdownValue <= 0) {
        clearInterval(this.countdownTimer!);
        this.countdownTimer = null;
        this.startFighting();
      } else {
        this.emit();
      }
    }, 1000);
  }

  private startFighting(): void {
    this.state.phase = "fighting";
    this.state.playerHealth = MAX_HEALTH;
    this.state.aiHealth = MAX_HEALTH;
    this.state.timeLeft = ROUND_DURATION;
    this.state.knockedDown = null;
    this.emit();
    this.startRoundTimer();
    this.scheduleAIPunch();
  }

  private startRoundTimer(): void {
    this.roundTimer = setInterval(() => {
      if (this.state.phase !== "fighting") return;
      this.state.timeLeft = Math.max(0, this.state.timeLeft - 1);
      if (this.state.timeLeft === 0) this.endRoundByTime();
      else this.emit();
    }, 1000);
  }

  private scheduleAIPunch(): void {
    if (this.state.phase !== "fighting") return;
    // Delay 1.8–4s; harder = faster
    const delay = 1800 + Math.random() * 2200;
    this.aiPunchTimer = setTimeout(() => {
      if (this.state.phase !== "fighting") return;
      const hand = Math.random() > 0.5 ? "left" : "right";
      this.onAIPunchCb?.(hand);
      const types = ["jab", "hook", "uppercut"] as const;
      const type = types[Math.floor(Math.random() * types.length)];
      const force = 0.35 + Math.random() * 0.5;
      this.applyDamage("ai", type, force);
      this.scheduleAIPunch();
    }, delay);
  }

  private applyDamage(
    attacker: "player" | "ai",
    punchType: string,
    force: number
  ): void {
    if (this.state.phase !== "fighting") return;
    const target = attacker === "player" ? "ai" : "player";
    const base = BASE_DMG[punchType] ?? 7;
    const raw = base * (0.4 + force * 0.6);
    const isBlocking =
      target === "player" ? this.state.isPlayerBlocking : this.state.isAIBlocking;
    const final = Math.round((isBlocking ? raw * BLOCK_REDUCTION : raw) * 10) / 10;

    if (target === "ai") {
      this.state.aiHealth = Math.max(0, this.state.aiHealth - final);
    } else {
      this.state.playerHealth = Math.max(0, this.state.playerHealth - final);
    }

    this.hitListeners.forEach((cb) => cb(target, force));
    this.emit();

    if (target === "ai" && this.state.aiHealth <= 0) this.startKnockdown("ai");
    else if (target === "player" && this.state.playerHealth <= 0) this.startKnockdown("player");
  }

  // ── Boxing knockdown / 8-count ───────────────────────────────────────────────
  private startKnockdown(who: "player" | "ai"): void {
    this.stopTimers(false); // keep round timer ref but pause
    this.state.phase = "knockdown";
    this.state.knockedDown = who;
    this.state.knockdownCount[who]++;
    this.state.eightCount = 8;
    this.emit();

    // Announce 8→10 count
    this.eightCountTimer = setInterval(() => {
      this.state.eightCount++;
      this.emit();
      if (this.state.eightCount >= 10) {
        clearInterval(this.eightCountTimer!);
        this.eightCountTimer = null;
        this.afterEightCount(who);
      }
    }, EIGHT_COUNT_SECS * 1000 / 3); // 3 ticks: 8, 9, 10
  }

  private afterEightCount(who: "player" | "ai"): void {
    const knockdowns = this.state.knockdownCount[who];

    // Three-knockdown rule → TKO
    if (knockdowns >= MAX_KNOCKDOWNS) {
      this.state.knockedDown = who; // stays as the TKO victim
      this.endRound(who === "ai" ? "player" : "ai", true);
      return;
    }

    // Fighter gets up — restore partial health
    if (who === "ai") {
      this.state.aiHealth = GETUP_HEALTH;
    } else {
      this.state.playerHealth = GETUP_HEALTH;
    }
    this.state.knockedDown = null;
    this.state.phase = "fighting";
    this.emit();
    this.startRoundTimer();
    this.scheduleAIPunch();
  }

  private endRound(winner: "player" | "ai", byKO: boolean): void {
    this.stopTimers();
    this.state.phase = "round-end";
    if (byKO) {
      this.state.roundsWon[winner]++;
    }
    this.emit();
    setTimeout(() => this.advanceRound(), ROUND_END_MS);
  }

  private endRoundByTime(): void {
    this.stopTimers();
    this.state.phase = "round-end";
    const aiDmg = MAX_HEALTH - this.state.aiHealth;
    const plDmg = MAX_HEALTH - this.state.playerHealth;
    if (aiDmg > plDmg) this.state.roundsWon.player++;
    else if (plDmg > aiDmg) this.state.roundsWon.ai++;
    // exact tie: no point awarded (judge's call)
    this.state.knockedDown = null;
    this.emit();
    setTimeout(() => this.advanceRound(), ROUND_END_MS);
  }

  private advanceRound(): void {
    const { roundsWon, round } = this.state;
    const needed = Math.ceil(MAX_ROUNDS / 2);
    if (roundsWon.player >= needed || roundsWon.ai >= needed || round >= MAX_ROUNDS) {
      this.state.phase = "game-over";
      this.state.winner = roundsWon.player > roundsWon.ai ? "player" : "ai";
      this.emit();
      return;
    }
    this.state.round++;
    this.state.knockdownCount = { player: 0, ai: 0 };
    this.state.phase = "countdown";
    this.startCountdown();
    this.emit();
  }

  private stopTimers(includeRound = true): void {
    if (includeRound && this.roundTimer) { clearInterval(this.roundTimer); this.roundTimer = null; }
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.eightCountTimer) { clearInterval(this.eightCountTimer); this.eightCountTimer = null; }
    if (this.aiPunchTimer) { clearTimeout(this.aiPunchTimer); this.aiPunchTimer = null; }
    if (this.comboTimer) { clearTimeout(this.comboTimer); this.comboTimer = null; }
  }
}
