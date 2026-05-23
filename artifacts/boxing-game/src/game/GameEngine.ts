import type { PunchEvent, PunchType } from "./PunchDetector";

export type GamePhase =
  | "start"
  | "camera-setup"
  | "tutorial"
  | "countdown"
  | "referee-start"
  | "camera-transition"
  | "fighting"
  | "knockdown"   // 8-count in progress
  | "round-end"
  | "game-over";

export type CombatState = "idle" | "stunned" | "guard-broken" | "dodging" | "blocking";

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
  opponentArchetype: CPUArchetype;
  opponentTier: CPUStage;
  trophies: number;
  streak: number;
  trackingQuality: number;

  // New Combat FSM properties
  playerStamina: number;
  aiStamina: number;
  playerExhausted: boolean;
  aiExhausted: boolean;
  playerCombatState: CombatState;
  aiCombatState: CombatState;
  playerStunEndTs: number;
  aiStunEndTs: number;
  playerDodgeEndTs: number;
  playerDodgeIFrameEndTs: number;
}

type CPUArchetype = "tank" | "speedster" | "balanced" | "aggressive";
type CPUStage = "early" | "mid" | "high" | "elite";

interface CPUProfile {
  archetype: CPUArchetype;
  stage: CPUStage;
  maxHealth: number;
  minDelay: number;
  maxDelay: number;
  reaction: number;
  defenseBias: number;
  counterBias: number;
  aggression: number;
  moveVariance: number;
  damageMul: number;
  preferredPunches: PunchType[];
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
const TROPHY_FLOOR = 0;
const TROPHY_CEIL = 500;

const BASE_DMG: Record<string, number> = {
  jab:      7,
  cross:    11,
  hook:     13,
  uppercut: 10,
  charge:   20,  // charge attack — heavy hitter
};
// % of damage that gets through when blocking (charge pierces guard more)
const BLOCK_REDUCTION: Record<string, number> = {
  jab:      0.20,
  cross:    0.22,
  hook:     0.20,
  uppercut: 0.20,
  charge:   0.45, // charge partially breaks guard
};

// Stamina cost parameters
const STAMINA_COSTS: Record<string, number> = {
  jab:      10,
  cross:    15,
  hook:     20,
  uppercut: 25,
  charge:   30,
};

// Stagger hit-stun durations (in ms)
const STUN_DURATIONS: Record<string, number> = {
  jab:      250,
  cross:    380,
  hook:     450,
  uppercut: 600,
  charge:   800,
};
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
  
  // High-frequency 60 FPS tick timer
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private hitStopEndTs = 0;

  private onAIPunchCb: ((hand: "left" | "right") => void) | null = null;
  private playerPattern: Record<PunchType, number> = { jab: 0, cross: 0, hook: 0, uppercut: 0, charge: 0 };
  private trackingSignal = { confidence: 0, speed: 0, blocking: false };

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
      phase: "referee-start",
      roundsWon: { ...this.state.roundsWon }, // preserve cross-round wins
      trophies: this.state.trophies,
      streak: this.state.streak,
    };
    this.state.opponentTier = this.getTierFromTrophies(this.state.trophies);
    this.state.opponentArchetype = this.pickArchetype(this.state.opponentTier);
    this.startRefereeCountdown();
    this.emit();
  }

  playerPunch(event: PunchEvent): void {
    if (this.state.phase !== "fighting") return;
    
    // Ignore input if player is currently stunned, guard-broken, or dodging
    if (this.state.playerCombatState === "stunned" || 
        this.state.playerCombatState === "guard-broken" || 
        this.state.playerCombatState === "dodging") {
      return;
    }

    const cost = STAMINA_COSTS[event.type] ?? 10;
    
    if (this.state.playerStamina < cost) {
      // Exhausted attack!
      this.state.playerExhausted = true;
      this.state.playerStamina = 0;
    } else {
      this.state.playerStamina -= cost;
    }

    this.state.lastPunchType = event.type;
    this.state.lastPunchForce = event.force;
    this.state.lastPunchTs = Date.now();
    
    this.applyDamage("player", event.type, event.force);
    this.playerPattern[event.type] = (this.playerPattern[event.type] ?? 0) + 1;

    // Combo tracking
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.state.comboCount++;
    this.comboTimer = setTimeout(() => {
      this.state.comboCount = 0;
      this.emit();
    }, 1500);
  }

  playerDodge(type: string): void {
    if (this.state.phase !== "fighting") return;
    
    // Can only dodge from idle or blocking
    if (this.state.playerCombatState !== "idle" && this.state.playerCombatState !== "blocking") {
      return;
    }

    const cost = 20; // 20 stamina cost to dodge
    if (this.state.playerStamina < cost) {
      return; // Ignore dodge if not enough stamina
    }

    this.state.playerStamina -= cost;
    this.state.playerCombatState = "dodging";
    const now = Date.now();
    this.state.playerDodgeEndTs = now + 520;       // Dodge active duration (520ms)
    this.state.playerDodgeIFrameEndTs = now + 350; // Dynamic core I-Frames (350ms)
    
    this.emit();
  }

  setPlayerBlocking(blocking: boolean): void {
    this.state.isPlayerBlocking = blocking;
  }

  setPlayerTrackingSignal(signal: { confidence: number; speed: number; blocking: boolean }): void {
    this.trackingSignal = signal;
    this.state.trackingQuality = Math.max(0, Math.min(1, signal.confidence));
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
      opponentArchetype: "balanced",
      opponentTier: "early",
      trophies: 0,
      streak: 0,
      trackingQuality: 0,

      // New default properties
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
    };
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb(this.getState()));
  }

  private startRefereeCountdown(): void {
    this.state.countdownValue = COUNTDOWN_DURATION;
    this.emit();
    this.countdownTimer = setInterval(() => {
      this.state.countdownValue--;
      if (this.state.countdownValue <= 0) {
        clearInterval(this.countdownTimer!);
        this.countdownTimer = null;
        this.state.phase = "camera-transition";
        this.emit();
      } else {
        this.emit();
      }
    }, 1000);
  }

  beginCombatAfterTransition(): void {
    const profile = this.getCPUProfile();
    this.state.phase = "fighting";
    this.state.playerHealth = MAX_HEALTH;
    this.state.aiHealth = profile.maxHealth;
    this.state.timeLeft = ROUND_DURATION;
    this.state.knockedDown = null;

    // Reset combat state properties
    this.state.playerStamina = 100;
    this.state.aiStamina = 100;
    this.state.playerExhausted = false;
    this.state.aiExhausted = false;
    this.state.playerCombatState = "idle";
    this.state.aiCombatState = "idle";
    this.state.playerStunEndTs = 0;
    this.state.aiStunEndTs = 0;
    this.state.playerDodgeEndTs = 0;
    this.state.playerDodgeIFrameEndTs = 0;

    this.emit();
    this.startRoundTimer();
    this.startTickTimer(); // Start 60 FPS update loop
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

  private startTickTimer(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      this.engineTick();
    }, 16.67);
  }

  private engineTick(): void {
    if (this.state.phase !== "fighting") return;
    const now = Date.now();

    // 1. Process Hit-Stop frame freeze
    if (now < this.hitStopEndTs) return;

    // 2. Process Player Dodge state decay
    if (this.state.playerCombatState === "dodging" && now >= this.state.playerDodgeEndTs) {
      this.state.playerCombatState = this.state.isPlayerBlocking ? "blocking" : "idle";
    }

    // 3. Process Player Stun / Guard Break state decay
    if ((this.state.playerCombatState === "stunned" || this.state.playerCombatState === "guard-broken") && now >= this.state.playerStunEndTs) {
      this.state.playerCombatState = this.state.isPlayerBlocking ? "blocking" : "idle";
    }

    // 4. Process AI Stun / Guard Break state decay
    if ((this.state.aiCombatState === "stunned" || this.state.aiCombatState === "guard-broken") && now >= this.state.aiStunEndTs) {
      this.state.aiCombatState = this.state.isAIBlocking ? "blocking" : "idle";
    }

    // 5. Update Player & AI blocking states based on tracking inputs
    if (this.state.playerCombatState === "idle" && this.state.isPlayerBlocking) {
      this.state.playerCombatState = "blocking";
    } else if (this.state.playerCombatState === "blocking" && !this.state.isPlayerBlocking) {
      this.state.playerCombatState = "idle";
    }

    if (this.state.aiCombatState === "idle" && this.state.isAIBlocking) {
      this.state.aiCombatState = "blocking";
    } else if (this.state.aiCombatState === "blocking" && !this.state.isAIBlocking) {
      this.state.aiCombatState = "idle";
    }

    // 6. Stamina Regeneration
    // Player
    if (this.state.playerCombatState === "idle") {
      const regen = this.state.playerExhausted ? 0.7 : 1.4; // Halved regen when exhausted
      this.state.playerStamina = Math.min(100, this.state.playerStamina + regen);
    } else if (this.state.playerCombatState === "blocking") {
      const regen = this.state.playerExhausted ? 0.2 : 0.4;
      this.state.playerStamina = Math.min(100, this.state.playerStamina + regen);
    }

    // Recover from player exhaustion when stamina reaches 100
    if (this.state.playerExhausted && this.state.playerStamina >= 100) {
      this.state.playerExhausted = false;
    }

    // AI
    if (this.state.aiCombatState === "idle") {
      const regen = this.state.aiExhausted ? 0.7 : 1.4;
      this.state.aiStamina = Math.min(100, this.state.aiStamina + regen);
    } else if (this.state.aiCombatState === "blocking") {
      const regen = this.state.aiExhausted ? 0.2 : 0.4;
      this.state.aiStamina = Math.min(100, this.state.aiStamina + regen);
    }

    if (this.state.aiExhausted && this.state.aiStamina >= 100) {
      this.state.aiExhausted = false;
    }

    this.emit();
  }

  private scheduleAIPunch(): void {
    if (this.state.phase !== "fighting") return;
    const profile = this.getCPUProfile();
    const adaptBias = this.getDominantPlayerPunchRatio();
    const delay = this.randRange(profile.minDelay, profile.maxDelay) * (1 + Math.random() * profile.moveVariance);
    this.aiPunchTimer = setTimeout(() => {
      if (this.state.phase !== "fighting") return;
      
      // If AI is currently stunned, guard-broken, or in knockdown/referee phase, skip and reschedule
      if (this.state.aiCombatState === "stunned" || this.state.aiCombatState === "guard-broken") {
        this.scheduleAIPunch();
        return;
      }

      const hand = Math.random() > 0.5 ? "left" : "right";
      this.onAIPunchCb?.(hand);
      
      const type = this.pickPunchType(profile);
      const cost = STAMINA_COSTS[type] ?? 10;
      
      if (this.state.aiStamina < cost) {
        // Exhausted AI Punch
        this.state.aiExhausted = true;
        this.state.aiStamina = 0;
      } else {
        this.state.aiStamina -= cost;
      }

      const speedBias = Math.min(0.18, this.trackingSignal.speed * 0.08);
      const reliabilityBias = Math.max(0, (this.trackingSignal.confidence - 0.5) * 0.12);
      const willBlock = Math.random() < profile.defenseBias + adaptBias + speedBias + reliabilityBias;
      this.state.isAIBlocking = willBlock;
      const counterWindow = profile.counterBias + adaptBias * 0.5 + (this.trackingSignal.blocking ? 0.12 : 0);
      
      if (Math.random() < profile.aggression || Math.random() < counterWindow) {
        const reactionVariance = 1 - (Math.random() * 0.22 - 0.11);
        const force = (0.32 + Math.random() * 0.58) * profile.damageMul * reactionVariance;
        this.applyDamage("ai", type, Math.min(1, Math.max(0.2, force)));
      }
      
      if (willBlock && Math.random() < profile.reaction) {
        setTimeout(() => {
          this.state.isAIBlocking = false;
          this.emit();
        }, this.randRange(250, 520));
      }
      
      this.emit();
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
    const now = Date.now();

    // 1. Dodge Invulnerability Frame check
    if (target === "player" && this.state.playerCombatState === "dodging" && now <= this.state.playerDodgeIFrameEndTs) {
      // Negate damage completely! Trigger 0-force hit callback representing dodge
      this.hitListeners.forEach((cb) => cb("player", 0));
      this.emit();
      return;
    }

    // 2. Counter-Hit Check
    const isTargetIdleOrBlocking = target === "player"
      ? (this.state.playerCombatState === "idle" || this.state.playerCombatState === "blocking")
      : (this.state.aiCombatState === "idle" || this.state.aiCombatState === "blocking");

    const isCounterHit = !isTargetIdleOrBlocking;
    const counterMultiplier = isCounterHit ? 1.5 : 1.0;

    // Apply 50% damage penalty if attacker is exhausted
    const isAttackerExhausted = attacker === "player" ? this.state.playerExhausted : this.state.aiExhausted;
    const exhaustionMul = isAttackerExhausted ? 0.5 : 1.0;

    const base = BASE_DMG[punchType] ?? 7;
    const raw = base * (0.4 + force * 0.6) * counterMultiplier * exhaustionMul;
    
    const isBlocking = target === "player"
      ? this.state.playerCombatState === "blocking"
      : this.state.aiCombatState === "blocking";

    let finalDamage = raw;
    let staminaDamage = 0;

    if (isBlocking) {
      const blockPct = BLOCK_REDUCTION[punchType] ?? 0.20;
      finalDamage = raw * blockPct;
      
      // Blocker takes stamina damage equal to rawDamage * 1.5
      staminaDamage = Math.round(raw * 1.5);
      
      if (target === "player") {
        this.state.playerStamina = Math.max(0, this.state.playerStamina - staminaDamage);
        if (this.state.playerStamina <= 0) {
          this.state.playerCombatState = "guard-broken";
          this.state.playerStunEndTs = now + 1000; // 1 second stun on guard break
        }
      } else {
        this.state.aiStamina = Math.max(0, this.state.aiStamina - staminaDamage);
        if (this.state.aiStamina <= 0) {
          this.state.aiCombatState = "guard-broken";
          this.state.aiStunEndTs = now + 1000;
        }
      }
    } else {
      // Unblocked strike triggers Hit-Stun stagger state!
      const stunBase = STUN_DURATIONS[punchType] ?? 250;
      const stunDuration = Math.round(stunBase * (isCounterHit ? 1.3 : 1.0));
      
      if (target === "player") {
        this.state.playerCombatState = "stunned";
        this.state.playerStunEndTs = now + stunDuration;
      } else {
        this.state.aiCombatState = "stunned";
        this.state.aiStunEndTs = now + stunDuration;
      }
    }

    const final = Math.round(finalDamage * 10) / 10;

    if (target === "ai") {
      this.state.aiHealth = Math.max(0, this.state.aiHealth - final);
    } else {
      this.state.playerHealth = Math.max(0, this.state.playerHealth - final);
    }

    // 3. Process Hit-Stop on high force or counter-hits
    if (force >= 0.70 || isCounterHit) {
      this.hitStopEndTs = now + 100;
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
    this.startTickTimer(); // Resume tick loop!
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
      this.applyProgressionResult();
      this.emit();
      return;
    }
    this.state.round++;
    this.state.knockdownCount = { player: 0, ai: 0 };
    this.state.phase = "countdown";
    this.startRefereeCountdown();
    this.emit();
  }

  private stopTimers(includeRound = true): void {
    if (includeRound && this.roundTimer) { clearInterval(this.roundTimer); this.roundTimer = null; }
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.eightCountTimer) { clearInterval(this.eightCountTimer); this.eightCountTimer = null; }
    if (this.aiPunchTimer) { clearTimeout(this.aiPunchTimer); this.aiPunchTimer = null; }
    if (this.comboTimer) { clearTimeout(this.comboTimer); this.comboTimer = null; }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; } // Clear 60 FPS loop!
  }

  private getTierFromTrophies(trophies: number): CPUStage {
    if (trophies >= 360) return "elite";
    if (trophies >= 220) return "high";
    if (trophies >= 90) return "mid";
    return "early";
  }

  private pickArchetype(stage: CPUStage): CPUArchetype {
    const pool: Record<CPUStage, CPUArchetype[]> = {
      early: ["balanced", "speedster"],
      mid: ["balanced", "tank", "aggressive", "speedster"],
      high: ["tank", "aggressive", "speedster", "balanced"],
      elite: ["tank", "aggressive", "speedster", "balanced"],
    };
    const p = pool[stage];
    return p[Math.floor(Math.random() * p.length)];
  }

  private getCPUProfile(): CPUProfile {
    const stage = this.state.opponentTier;
    const arch = this.state.opponentArchetype;
    const stageMul = stage === "elite" ? 1.15 : stage === "high" ? 1.05 : stage === "mid" ? 0.95 : 0.85;
    const base: Record<CPUArchetype, CPUProfile> = {
      tank: { archetype: "tank", stage, maxHealth: 118, minDelay: 1150, maxDelay: 2100, reaction: 0.5, defenseBias: 0.52, counterBias: 0.58, aggression: 0.45, moveVariance: 0.2, damageMul: 1.1, preferredPunches: ["hook", "cross", "uppercut", "jab"] },
      speedster: { archetype: "speedster", stage, maxHealth: 84, minDelay: 650, maxDelay: 1300, reaction: 0.72, defenseBias: 0.34, counterBias: 0.42, aggression: 0.68, moveVariance: 0.26, damageMul: 0.82, preferredPunches: ["jab", "cross", "hook", "jab", "uppercut"] },
      balanced: { archetype: "balanced", stage, maxHealth: 100, minDelay: 900, maxDelay: 1650, reaction: 0.6, defenseBias: 0.43, counterBias: 0.46, aggression: 0.56, moveVariance: 0.22, damageMul: 0.98, preferredPunches: ["jab", "cross", "hook", "uppercut"] },
      aggressive: { archetype: "aggressive", stage, maxHealth: 94, minDelay: 700, maxDelay: 1250, reaction: 0.55, defenseBias: 0.25, counterBias: 0.35, aggression: 0.86, moveVariance: 0.28, damageMul: 1.04, preferredPunches: ["hook", "cross", "hook", "jab", "uppercut"] },
    };
    const selected = { ...base[arch] };
    selected.minDelay *= 1.15 - (stageMul - 0.85);
    selected.maxDelay *= 1.12 - (stageMul - 0.85);
    selected.damageMul *= stageMul;
    selected.reaction = Math.min(0.92, selected.reaction + (stageMul - 0.85) * 0.35);
    return selected;
  }

  private pickPunchType(profile: CPUProfile): PunchType {
    const idx = Math.floor(Math.random() * profile.preferredPunches.length);
    return profile.preferredPunches[idx] ?? "jab";
  }

  private getDominantPlayerPunchRatio(): number {
    const total = Object.values(this.playerPattern).reduce((a, b) => a + b, 0);
    if (total < 4) return 0;
    const dominant = Math.max(...Object.values(this.playerPattern));
    return Math.min(0.2, dominant / total * 0.25);
  }

  private applyProgressionResult(): void {
    if (!this.state.winner) return;
    const tierBonus = this.state.opponentTier === "elite" ? 28 : this.state.opponentTier === "high" ? 21 : this.state.opponentTier === "mid" ? 15 : 10;
    if (this.state.winner === "player") {
      this.state.streak += 1;
      const streakBonus = this.state.streak >= 3 ? 8 : this.state.streak >= 2 ? 4 : 0;
      this.state.trophies = Math.min(TROPHY_CEIL, this.state.trophies + tierBonus + streakBonus);
    } else {
      this.state.streak = 0;
      this.state.trophies = Math.max(TROPHY_FLOOR, this.state.trophies - Math.ceil(tierBonus * 0.7));
    }
    this.state.opponentTier = this.getTierFromTrophies(this.state.trophies);
  }

  private randRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
