import type { PunchEvent } from "./PunchDetector";

export type GamePhase =
  | "start"
  | "camera-setup"
  | "countdown"
  | "fighting"
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
  knockedOut: "player" | "ai" | null;
  winner: "player" | "ai" | null;
  countdownValue: number;
  isPlayerBlocking: boolean;
  isAIBlocking: boolean;
  lastPunchInfo: string;
  comboCount: number;
}

export type StateListener = (state: GameState) => void;
export type HitEvent = (target: "player" | "ai", force: number) => void;

const ROUND_DURATION = 60; // seconds
const COUNTDOWN_DURATION = 3;
const ROUND_END_DURATION = 4000; // ms
const MAX_HEALTH = 100;
const MAX_ROUNDS = 3;

// Damage config
const PUNCH_DAMAGE: Record<string, number> = {
  jab: 6,
  hook: 11,
  uppercut: 9,
};
const BLOCK_REDUCTION = 0.25; // 75% damage reduction when blocking

export class GameEngine {
  private state: GameState = this.defaultState();
  private listeners: StateListener[] = [];
  private hitListeners: HitEvent[] = [];
  private roundTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;
  private aiPunchTimer: ReturnType<typeof setTimeout> | null = null;
  private onAIPunch: ((hand: "left" | "right") => void) | null = null;

  private defaultState(): GameState {
    return {
      phase: "start",
      round: 1,
      maxRounds: MAX_ROUNDS,
      playerHealth: MAX_HEALTH,
      aiHealth: MAX_HEALTH,
      timeLeft: ROUND_DURATION,
      roundsWon: { player: 0, ai: 0 },
      knockedOut: null,
      winner: null,
      countdownValue: COUNTDOWN_DURATION,
      isPlayerBlocking: false,
      isAIBlocking: false,
      lastPunchInfo: "",
      comboCount: 0,
    };
  }

  onState(cb: StateListener): void {
    this.listeners.push(cb);
  }

  onHit(cb: HitEvent): void {
    this.hitListeners.push(cb);
  }

  setAIPunchCallback(cb: (hand: "left" | "right") => void): void {
    this.onAIPunch = cb;
  }

  getState(): GameState {
    return { ...this.state };
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb(this.getState()));
  }

  startCameraSetup(): void {
    this.state = { ...this.defaultState(), phase: "camera-setup" };
    this.emit();
  }

  startMatch(): void {
    this.state = { ...this.defaultState(), phase: "countdown" };
    this.startCountdown();
    this.emit();
  }

  private startCountdown(): void {
    this.state.countdownValue = COUNTDOWN_DURATION;
    this.emit();
    this.countdownTimer = setInterval(() => {
      this.state.countdownValue--;
      if (this.state.countdownValue <= 0) {
        clearInterval(this.countdownTimer!);
        this.startFighting();
      }
      this.emit();
    }, 1000);
  }

  private startFighting(): void {
    this.state.phase = "fighting";
    this.state.playerHealth = MAX_HEALTH;
    this.state.aiHealth = MAX_HEALTH;
    this.state.timeLeft = ROUND_DURATION;
    this.state.knockedOut = null;
    this.emit();
    this.startRoundTimer();
    this.scheduleAIPunch();
  }

  private startRoundTimer(): void {
    this.roundTimer = setInterval(() => {
      if (this.state.phase !== "fighting") return;
      this.state.timeLeft = Math.max(0, this.state.timeLeft - 1);
      if (this.state.timeLeft === 0) {
        this.endRoundByTime();
      }
      this.emit();
    }, 1000);
  }

  private scheduleAIPunch(): void {
    if (this.state.phase !== "fighting") return;
    // AI punches every 1.5-3.5 seconds
    const delay = 1500 + Math.random() * 2000;
    this.aiPunchTimer = setTimeout(() => {
      if (this.state.phase !== "fighting") return;
      const hand = Math.random() > 0.5 ? "left" : "right";
      this.onAIPunch?.(hand);

      // AI deals damage to player
      const types = ["jab", "hook", "uppercut"] as const;
      const type = types[Math.floor(Math.random() * types.length)];
      const force = 0.4 + Math.random() * 0.6;
      this.applyDamage("ai", type, force);

      this.scheduleAIPunch();
    }, delay);
  }

  playerPunch(event: PunchEvent): void {
    if (this.state.phase !== "fighting") return;
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
    this.emit();
  }

  private applyDamage(
    attacker: "player" | "ai",
    punchType: string,
    force: number
  ): void {
    const target = attacker === "player" ? "ai" : "player";
    const base = PUNCH_DAMAGE[punchType] ?? 6;
    const damage = base * (0.5 + force * 0.5);
    const isTargetBlocking =
      target === "player" ? this.state.isPlayerBlocking : this.state.isAIBlocking;
    const finalDamage = isTargetBlocking ? damage * BLOCK_REDUCTION : damage;

    const rounded = Math.round(finalDamage * 10) / 10;
    if (target === "ai") {
      this.state.aiHealth = Math.max(0, this.state.aiHealth - rounded);
      this.state.lastPunchInfo = `${punchType.toUpperCase()} ${isTargetBlocking ? "(blocked)" : ""} -${Math.round(rounded)}`;
    } else {
      this.state.playerHealth = Math.max(0, this.state.playerHealth - rounded);
    }

    this.hitListeners.forEach((cb) => cb(target, force));

    if (target === "ai" && this.state.aiHealth <= 0) {
      this.knockOut("ai");
    } else if (target === "player" && this.state.playerHealth <= 0) {
      this.knockOut("player");
    } else {
      this.emit();
    }
  }

  private knockOut(who: "player" | "ai"): void {
    this.stopTimers();
    this.state.phase = "round-end";
    this.state.knockedOut = who;
    if (who === "ai") {
      this.state.roundsWon.player++;
    } else {
      this.state.roundsWon.ai++;
    }
    this.emit();
    setTimeout(() => this.advanceRound(), ROUND_END_DURATION);
  }

  private endRoundByTime(): void {
    this.stopTimers();
    this.state.phase = "round-end";
    const playerDamage = MAX_HEALTH - this.state.playerHealth;
    const aiDamage = MAX_HEALTH - this.state.aiHealth;
    if (aiDamage > playerDamage) {
      this.state.roundsWon.player++;
    } else if (playerDamage > aiDamage) {
      this.state.roundsWon.ai++;
    }
    this.state.knockedOut = null;
    this.emit();
    setTimeout(() => this.advanceRound(), ROUND_END_DURATION);
  }

  private advanceRound(): void {
    if (
      this.state.roundsWon.player > MAX_ROUNDS / 2 ||
      this.state.roundsWon.ai > MAX_ROUNDS / 2 ||
      this.state.round >= MAX_ROUNDS
    ) {
      this.state.phase = "game-over";
      this.state.winner =
        this.state.roundsWon.player > this.state.roundsWon.ai ? "player" : "ai";
      this.emit();
      return;
    }
    this.state.round++;
    this.startCountdown();
    this.state.phase = "countdown";
    this.emit();
  }

  private stopTimers(): void {
    if (this.roundTimer) clearInterval(this.roundTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.aiPunchTimer) clearTimeout(this.aiPunchTimer);
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.roundTimer = null;
    this.countdownTimer = null;
    this.aiPunchTimer = null;
  }

  reset(): void {
    this.stopTimers();
    this.state = this.defaultState();
    this.emit();
  }
}
