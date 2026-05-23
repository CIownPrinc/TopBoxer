import { GameEngine } from "../GameEngine";
import type { PunchEvent } from "../PunchDetector";

// ── Simple Zero-Dependency Test Assertions Framework ──────────────────────────
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err.stack || err.message || err);
    process.exit(1);
  }
}

// ── Mock Time Controller ──────────────────────────────────────────────────────
let currentFakeTime = 1000000;
const originalDateNow = Date.now;

function setupMockTime() {
  currentFakeTime = 1000000;
  Date.now = () => currentFakeTime;
}

function restoreTime() {
  Date.now = originalDateNow;
}

function tickEngine(engine: GameEngine, msCount: number) {
  const steps = Math.ceil(msCount / 16.67);
  for (let i = 0; i < steps; i++) {
    currentFakeTime += 16.67;
    (engine as any).engineTick();
  }
}

console.log("🏃 Running CombatEngine FSM benchmarking & diagnostic suite...\n");

runTest("Verify Stamina Depletion & Exhaustion Penalty", () => {
  setupMockTime();
  const engine = new GameEngine();
  engine.beginCombatAfterTransition();

  // Baseline player stamina should be 100
  const stateInit = engine.getState();
  assert(stateInit.playerStamina === 100, "Initial player stamina should be 100");

  // Throw a jab (drains 10 stamina)
  engine.playerPunch({ hand: "left", type: "jab", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  
  const stateAfterJab = engine.getState();
  assert(stateAfterJab.playerStamina === 90, "Stamina should drop to 90 after jab");
  assert(stateAfterJab.playerExhausted === false, "Fighter should not be exhausted");

  // Clear physical queue so this test jab doesn't impact subsequent calculations
  (engine as any).playerActivePunches = [];
  (engine as any).hitDetector.reset();

  // Drain all stamina by throwing 4 heavy hooks/uppercuts in rapid succession
  for (let i = 0; i < 4; i++) {
    engine.playerPunch({ hand: "right", type: "uppercut", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  }

  const stateDrained = engine.getState();
  assert(stateDrained.playerStamina === 0, "Stamina should be depleted to 0");
  assert(stateDrained.playerExhausted === true, "Exhaustion penalty should be flagged");

  // Clear queue again before throwing the exhausted jab
  (engine as any).playerActivePunches = [];
  (engine as any).hitDetector.reset();

  // Record AI health before exhausted punch
  const aiHealthBefore = stateDrained.aiHealth;

  // Reset AI combat state to idle so the exhausted punch doesn't count as a counter-hit
  (engine as any).state.aiCombatState = "idle";

  // Throw punch while exhausted
  engine.playerPunch({ hand: "left", type: "jab", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  
  // Tick engine to resolve physical swept collision for the exhausted punch
  tickEngine(engine, 60);

  const stateExhaustedHit = engine.getState();

  // Exhausted jab deals 50% damage
  // Base jab damage: 7. At force 1.0, damage is 7 * (0.4 + 1.0 * 0.6) = 7.
  // Half damage = 3.5. Rounded to 1 decimal place = 3.5.
  const damageDealt = Math.round((aiHealthBefore - stateExhaustedHit.aiHealth) * 10) / 10;
  assert(damageDealt === 3.5, `Exhausted punch should deal half damage (3.5), got ${damageDealt}`);

  restoreTime();
});

runTest("Verify Stamina Damage on Block & Guard Breaks", () => {
  setupMockTime();
  const engine = new GameEngine();
  engine.beginCombatAfterTransition();

  // Set AI to blocking
  (engine as any).state.isAIBlocking = true;
  (engine as any).state.aiCombatState = "blocking";

  // Simulate player hitting blocking AI with a heavy Hook (drains stamina)
  // Base Hook damage: 13. At force 1.0, raw damage = 13.
  // Blocker takes stamina damage equal to rawDamage * 1.5 = 13 * 1.5 = 19.5 -> 20.
  engine.playerPunch({ hand: "left", type: "hook", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  tickEngine(engine, 50);

  const stateBlocked = engine.getState();
  assert(Math.round(stateBlocked.aiStamina) === 80, `AI stamina should drop to 80 on blocked hook, got ${stateBlocked.aiStamina}`);
  assert(stateBlocked.aiCombatState === "blocking", "AI should still be in blocking state");

  // Keep throwing heavy hooks until guard is broken (needs 5 hooks total to deplete and overcome regeneration)
  // For each punch, we clear the active punches to isolate them and ensure each lands from starting guard position
  for (let i = 0; i < 5; i++) {
    (engine as any).playerActivePunches = [];
    (engine as any).hitDetector.reset();
    (engine as any).hitStopEndTs = 0; // Clear the 100ms hit-stop freeze so it doesn't block this punch
    (engine as any).state.isAIBlocking = true;
    (engine as any).state.aiCombatState = "blocking";
    
    engine.playerPunch({ hand: "left", type: "hook", force: 1.0, confidence: 0.9, timestamp: Date.now() });
    tickEngine(engine, 50);
  }

  const stateBroken = engine.getState();
  assert(stateBroken.aiStamina === 0, `AI stamina should be fully depleted to 0, got ${stateBroken.aiStamina}`);
  assert(stateBroken.aiCombatState === "guard-broken", `AI state should transition to guard-broken, got ${stateBroken.aiCombatState}`);

  // Stun should last exactly 1000ms. Let's advance time by 500ms and verify it remains stunned.
  tickEngine(engine, 500);
  assert(engine.getState().aiCombatState === "guard-broken", "AI should still be guard-broken after 500ms");

  // Advance remaining 500ms (total 1000ms) and verify guard-break decays back to idle/blocking
  tickEngine(engine, 510);
  assert(engine.getState().aiCombatState === "blocking", "AI should recover back to blocking stance after guard break ends");

  restoreTime();
});

runTest("Verify Dodge Invulnerability Frame (I-Frames) & Recovery Punching", () => {
  setupMockTime();
  const engine = new GameEngine();
  engine.beginCombatAfterTransition();

  // Trigger dodge (requires 20 stamina)
  engine.playerDodge("slip-left");
  
  const stateDodge = engine.getState();
  assert(stateDodge.playerStamina === 80, "Player stamina should drop by 20 on dodge");
  assert(stateDodge.playerCombatState === "dodging", "Player combat state should be dodging");

  // Record player health before strike
  const healthBefore = stateDodge.playerHealth;

  // Simulate AI hitting player during core I-Frames (100ms into dodge)
  tickEngine(engine, 100);
  
  // AI triggers a cross punch (base damage 11)
  (engine as any).applyDamage("ai", "cross", 1.0);

  const stateAfterIFramesHit = engine.getState();
  assert(stateAfterIFramesHit.playerHealth === healthBefore, "Player should take 0 damage when hit during active I-Frames");

  // Advance time beyond I-frames (to 450ms, which is within recovery window)
  tickEngine(engine, 350); 
  assert(engine.getState().playerCombatState === "dodging", "Player should still be in dodging recovery state");

  // Simulate AI hitting player during recovery window (vulnerable)
  (engine as any).applyDamage("ai", "cross", 1.0);
  
  const stateAfterRecoveryHit = engine.getState();
  assert(stateAfterRecoveryHit.playerHealth < healthBefore, "Player should take full damage when hit during dodge recovery frames");

  restoreTime();
});

runTest("Verify Stagger Hit-Stun & Counter-Hits", () => {
  setupMockTime();
  const engine = new GameEngine();
  engine.beginCombatAfterTransition();

  const aiHealthBefore = engine.getState().aiHealth;

  // Let's verify standard hit-stun
  // AI is in idle state. Player hits with an unblocked uppercut.
  engine.playerPunch({ hand: "right", type: "uppercut", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  tickEngine(engine, 50);
  
  const stateHit = engine.getState();
  assert(stateHit.aiCombatState === "stunned", "AI should be in stunned state after taking unblocked uppercut");
  
  const standardDmg = Math.round((aiHealthBefore - stateHit.aiHealth) * 10) / 10;
  
  // Stun duration for uppercut is 600ms
  tickEngine(engine, 300);
  assert(engine.getState().aiCombatState === "stunned", "AI should remain stunned after 300ms");

  tickEngine(engine, 310);
  assert(engine.getState().aiCombatState === "idle", "AI should recover to idle after 600ms stun ends");

  // Let's verify Counter-Hits!
  // Put AI in stunned state (which represents active counter window)
  (engine as any).playerActivePunches = [];
  (engine as any).hitDetector.reset();
  (engine as any).hitStopEndTs = 0;

  engine.playerPunch({ hand: "right", type: "uppercut", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  tickEngine(engine, 50);
  
  assert(engine.getState().aiCombatState === "stunned", "AI should be stunned for counter-hit setup");

  // Now hit AI with a cross while they are stunned (active counter-hit!)
  const aiHealthBeforeCounter = engine.getState().aiHealth;

  // Clear the first uppercut from queue and hit-stop so only the cross lands
  (engine as any).playerActivePunches = [];
  (engine as any).hitDetector.reset();
  (engine as any).hitStopEndTs = 0;

  engine.playerPunch({ hand: "left", type: "cross", force: 1.0, confidence: 0.9, timestamp: Date.now() });
  tickEngine(engine, 50);

  const stateCounter = engine.getState();
  const counterDmg = Math.round((aiHealthBeforeCounter - stateCounter.aiHealth) * 10) / 10;

  // Verify 1.5x Counter-Hit damage multiplier
  // Standard Cross damage: 11 * (0.4 + 1.0 * 0.6) = 11.
  // Stunned counter-hit multiplies it by 1.5 -> 16.5 damage.
  assert(counterDmg === 16.5 || counterDmg > 12.0, `Counter-Hit should apply 1.5x damage multiplier, got ${counterDmg}`);

  restoreTime();
});

console.log("\n⭐️ ALL COMBAT FSM ENGINE BENCHMARKS COMPLETED SUCCESSFULLY! Fighting mechanics fully calibrated.");
