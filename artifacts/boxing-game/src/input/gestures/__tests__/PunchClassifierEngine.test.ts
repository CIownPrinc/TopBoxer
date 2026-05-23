import { PunchClassifierEngine, defaultEngineConfig } from "../PunchClassifierEngine";
import type { HandMotionSample, HandQuality, Vec3 } from "../../../types";

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

// ── Mock Generators ──────────────────────────────────────────────────────────
const defaultQuality: HandQuality = {
  visible: true,
  confidence: 0.95,
  stability: 1.0,
  jitter: 0.05,
  droppedFrames: 0,
  status: "valid",
};

function createSample(
  side: "left" | "right",
  timestampMs: number,
  smoothedPosition: Vec3,
  velocity: Vec3,
  acceleration: Vec3
): HandMotionSample {
  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
  const m = Math.max(1e-6, speed);
  
  return {
    side,
    timestampMs,
    rawPosition: smoothedPosition,
    calibratedPosition: smoothedPosition,
    smoothedPosition,
    predictedPosition: smoothedPosition,
    velocity,
    smoothedVelocity: velocity,
    acceleration,
    speed,
    direction: speed < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: velocity.x / m, y: velocity.y / m, z: velocity.z / m },
    distanceFromGuard: Math.sqrt(smoothedPosition.x ** 2 + smoothedPosition.y ** 2 + smoothedPosition.z ** 2), // centered guard
    extensionRatio: Math.min(1.0, Math.sqrt(smoothedPosition.x ** 2 + smoothedPosition.y ** 2 + smoothedPosition.z ** 2) / 0.5), // 0.5m reach
    lateralRatio: Math.abs(velocity.x) / m,
    verticalRatio: Math.abs(velocity.y) / m,
    forwardRatio: Math.abs(velocity.z) / m,
    quality: defaultQuality,
    landmarks: [],
  };
}

// ── Main Test Suite ──────────────────────────────────────────────────────────
console.log("🏃 Running PunchClassifierEngine verification suite...\n");

runTest("Verify Initial Stasis is IDLE", () => {
  const engine = new PunchClassifierEngine("left");
  const sample = createSample("left", 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const candidate = engine.update(sample, 0);
  
  assert(candidate === null, "Fist in stasis should not trigger a punch");
  assert(engine.getLegacyState() === "idle", "Initial state must be idle");
});

runTest("Jab Detection through FSM Phases (Orthodox Lead Left)", () => {
  const engine = new PunchClassifierEngine("left");
  let now = 1000;
  const dt = 1 / 30; // 30 FPS
  
  // Phase 1: Hand loading back (Chambering)
  // Moving backward/downward along Y/Z axes
  for (let i = 0; i < 5; i++) {
    now += dt * 1000;
    const sample = createSample(
      "left",
      now,
      { x: 0, y: 0.05, z: 0.05 },
      { x: 0, y: 0.15, z: 0.15 }, // positive velocities (away from target)
      { x: 0, y: 1.2, z: 1.2 }
    );
    engine.update(sample, now);
  }
  assert(engine.getLegacyState() === "cocking", "Retracting fist should activate chambering (cocking)");

  // Phase 2: Explosive Extension forward
  // High velocity forward (Z-negative)
  for (let i = 0; i < 6; i++) {
    now += dt * 1000;
    const sample = createSample(
      "left",
      now,
      { x: 0, y: -0.15, z: -0.25 },
      { x: 0, y: -0.2, z: -1.2 }, // rapid forward movement
      { x: 0, y: -1.5, z: -6.5 }
    );
    engine.update(sample, now);
  }
  assert(engine.getLegacyState() === "punching", "Explosive forward speed should activate extension (punching)");

  // Phase 3: IMPACT (Sudden Deceleration Spike & Extension)
  now += dt * 1000;
  const impactSample = createSample(
    "left",
    now,
    { x: 0, y: -0.2, z: -0.42 }, // High extension
    { x: 0, y: -0.05, z: -0.1 }, // Speed plummeted
    { x: 0, y: 2.1, z: 15.8 } // Massive deceleration spike opposing forward velocity
  );
  
  const candidate = engine.update(impactSample, now);
  
  assert(candidate !== null, "Impact deceleration should trigger a punch event");
  assert(candidate!.type === "jab", "Lead hand Orthodox punch must be a jab");
  assert(candidate!.confidence >= 0.65, "Jab confidence should be high");
  assert(candidate!.strength >= 0.5, "Fast velocity should result in significant force strength");
  assert(engine.getLegacyState() === "punching", "Engine must remain in punching/impact state on impact frame");

  // Phase 4: Recovery
  now += dt * 1000;
  const recoverySample = createSample(
    "left",
    now,
    { x: 0, y: -0.1, z: -0.2 },
    { x: 0, y: 0.3, z: 0.6 }, // moving backward to guard
    { x: 0, y: 0.5, z: 0.8 }
  );
  engine.update(recoverySample, now);
  assert(engine.getLegacyState() === "cooldown", "Recovery phase must map to legacy cooldown");
});

runTest("Hook Punch Directional Vector Separation (X-Axis Dominant)", () => {
  const engine = new PunchClassifierEngine("right");
  let now = 2000;
  const dt = 1 / 30;

  // Extension Phase - strong lateral movement along X
  for (let i = 0; i < 8; i++) {
    now += dt * 1000;
    const sample = createSample(
      "right",
      now,
      { x: -0.25, y: -0.05, z: -0.05 },
      { x: -1.3, y: -0.1, z: -0.1 }, // dominant X speed
      { x: -7.2, y: -0.2, z: -0.2 }
    );
    engine.update(sample, now);
  }

  // Impact Deceleration along lateral axis
  now += dt * 1000;
  const impactSample = createSample(
    "right",
    now,
    { x: -0.38, y: -0.05, z: -0.05 },
    { x: -0.05, y: 0, z: 0 },
    { x: 16.5, y: 0, z: 0 } // high X deceleration
  );
  const candidate = engine.update(impactSample, now);

  assert(candidate !== null, "Hook motion should trigger a punch event");
  assert(candidate!.type === "hook", "Lateral dominant movement must classify as a hook");
});

runTest("Uppercut Rising Motion Separation (Y-Axis Negative)", () => {
  const engine = new PunchClassifierEngine("left");
  let now = 3000;
  const dt = 1 / 30;

  // Extension Phase - strong upward movement (Y-negative)
  for (let i = 0; i < 7; i++) {
    now += dt * 1000;
    const sample = createSample(
      "left",
      now,
      { x: 0.05, y: -0.28, z: -0.05 },
      { x: 0.1, y: -1.2, z: -0.1 }, // dominant Y-negative speed
      { x: 0.2, y: -8.0, z: -0.2 }
    );
    engine.update(sample, now);
  }

  // Impact Deceleration Y-positive
  now += dt * 1000;
  const impactSample = createSample(
    "left",
    now,
    { x: 0.05, y: -0.38, z: -0.05 },
    { x: 0, y: -0.02, z: 0 },
    { x: 0, y: 18.2, z: 0 } // high upward deceleration
  );
  const candidate = engine.update(impactSample, now);

  assert(candidate !== null, "Rising motion should trigger a punch event");
  assert(candidate!.type === "uppercut", "Rising upward movement must classify as an uppercut");
});

runTest("Verify Frame-Rate Independence (30 FPS vs 90 FPS)", () => {
  const runSequence = (fps: number): PunchType | null => {
    const engine = new PunchClassifierEngine("right");
    const dt = 1 / fps;
    let now = 5000;

    // 1. Extension
    const extensionFrames = Math.max(2, Math.round(0.2 * fps)); // 200ms extension
    for (let i = 0; i < extensionFrames; i++) {
      now += dt * 1000;
      const sample = createSample(
        "right",
        now,
        { x: 0, y: -0.1, z: -0.2 },
        { x: 0, y: -0.1, z: -1.1 },
        { x: 0, y: -0.2, z: -6.0 }
      );
      engine.update(sample, now);
    }

    // 2. Impact Deceleration Spike
    now += dt * 1000;
    const impactSample = createSample(
      "right",
      now,
      { x: 0, y: -0.15, z: -0.4 },
      { x: 0, y: -0.01, z: -0.05 },
      { x: 0, y: 0.5, z: 16.5 }
    );
    const candidate = engine.update(impactSample, now);
    return candidate ? (candidate.type as PunchType) : null;
  };

  const punch30 = runSequence(30);
  const punch90 = runSequence(90);

  assert(punch30 !== null, "Punch must trigger at 30 FPS");
  assert(punch90 !== null, "Punch must trigger at 90 FPS");
  assert(punch30 === "cross", "30 FPS punch should be a cross");
  assert(punch90 === "cross", "90 FPS punch should be a cross");
  assert(punch30 === punch90, "Punch classification must be identical across varying framerates");
});

console.log("\n⭐️ ALL TESTS COMPLETED SUCCESSFULLY! state-machine physics engine matches all requirements.");
