import { Kalman3DFilter, defaultKalmanConfig } from "../KalmanFilter";
import type { Vec3 } from "../../types";

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

// Reusable pseudo-random number generator with seed (for deterministic testing)
class SeededRandom {
  private seed: number;
  constructor(seed = 42) { this.seed = seed; }
  next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
  gaussian(mean = 0, stdDev = 1): number {
    const u1 = this.next() || 1e-9;
    const u2 = this.next() || 1e-9;
    const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    return mean + stdDev * randStdNormal;
  }
}

console.log("🏃 Running Kalman3DFilter benchmarking & diagnostic suite...\n");

runTest("Verify Initial Measurement Pass-through", () => {
  const filter = new Kalman3DFilter();
  const measured = { x: 0.5, y: 0.4, z: -0.2 };
  const res = filter.update(measured, 1000);
  
  assert(res.position.x === measured.x, "Initial X should match exactly");
  assert(res.position.y === measured.y, "Initial Y should match exactly");
  assert(res.position.z === measured.z, "Initial Z should match exactly");
});

runTest("Static Guard Jitter Suppression Benchmarking", () => {
  const filter = new Kalman3DFilter();
  const basePosition = { x: 0.5, y: 0.4, z: -0.2 };
  const rng = new SeededRandom(101);
  const dt = 1 / 30; // 30 FPS
  let now = 1000;

  const rawPositions: Vec3[] = [];
  const smoothedPositions: Vec3[] = [];

  // Generate 120 frames (~4 seconds) of jittery static guard positions
  for (let i = 0; i < 120; i++) {
    now += dt * 1000;
    const jittered = {
      x: basePosition.x + rng.gaussian(0, 0.015), // Standard deviation of 1.5%
      y: basePosition.y + rng.gaussian(0, 0.015),
      z: basePosition.z + rng.gaussian(0, 0.015),
    };
    rawPositions.push(jittered);
    
    const res = filter.update(jittered, now, 0.95);
    smoothedPositions.push(res.position);
  }

  // Calculate variance (standard deviation) of raw vs smoothed
  const getStdDev = (arr: number[]): number => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sqDiff = arr.map((v) => (v - mean) ** 2);
    return Math.sqrt(sqDiff.reduce((a, b) => a + b, 0) / arr.length);
  };

  // Skip the first 30 frames of "burn-in" / convergence to measure true steady-state performance
  const rawXStd = getStdDev(rawPositions.slice(30).map(p => p.x));
  const smoothXStd = getStdDev(smoothedPositions.slice(30).map(p => p.x));

  const jitterReductionRatio = (rawXStd - smoothXStd) / rawXStd;
  console.log(`📊 Static Jitter STD - Raw: ${rawXStd.toFixed(5)}, Smoothed: ${smoothXStd.toFixed(5)}`);
  console.log(`📊 Jitter suppression efficiency: ${(jitterReductionRatio * 100).toFixed(1)}%`);

  assert(smoothXStd < rawXStd, "Smoothed position standard deviation must be lower than raw");
  assert(jitterReductionRatio >= 0.75, "Filter must suppress at least 75% of high-frequency jitter");
});

runTest("Dampen Sudden Teleportation Jumps using Dynamic Confidence Noise", () => {
  const filter = new Kalman3DFilter();
  let now = 1000;
  const dt = 1 / 30;

  // 1. Establish stable guard position
  for (let i = 0; i < 15; i++) {
    now += dt * 1000;
    filter.update({ x: 0.5, y: 0.4, z: -0.2 }, now, 0.98);
  }

  // 2. Sudden, massive teleportation jump (e.g. tracking glitch) with LOW confidence (0.15)
  now += dt * 1000;
  const teleportPosition = { x: 0.75, y: 0.4, z: -0.2 }; // massive 0.25 jump
  const res = filter.update(teleportPosition, now, 0.15); // low confidence!

  const teleportDistance = Math.abs(res.position.x - 0.5);
  console.log(`📊 Glitch Teleportation Jump - Raw: 0.250, Smoothed First-Frame: ${teleportDistance.toFixed(4)}`);

  assert(teleportDistance < 0.08, "Kalman filter should highly dampen sudden teleportation when tracking confidence is low");
});

runTest("Minimizing Lag & Fast Punch Responsiveness", () => {
  const filter = new Kalman3DFilter();
  const dt = 1 / 60; // High speed 60 FPS camera tracking
  let now = 1000;

  const trueTrajectory: number[] = [];
  const estimatedTrajectory: number[] = [];

  // Simulate a rapid straight forward jab extension (along Z-axis from 0.0 to -0.45 at 1.5 units/s)
  // Total duration: 300ms (18 frames at 60 FPS)
  const speed = 1.5;
  for (let i = 0; i < 18; i++) {
    now += dt * 1000;
    const trueZ = -speed * (i * dt);
    const measuredZ = trueZ; // perfect measurement, no noise to isolate lag
    
    trueTrajectory.push(trueZ);
    const res = filter.update({ x: 0.5, y: 0.4, z: measuredZ }, now, 0.98);
    estimatedTrajectory.push(res.position.z);
  }

  // Compute average physical latency lag (distance lag divided by speed = time lag)
  let totalLagMs = 0;
  for (let i = 2; i < 18; i++) {
    const distanceLag = Math.abs(trueTrajectory[i] - estimatedTrajectory[i]);
    const timeLagMs = (distanceLag / speed) * 1000;
    totalLagMs += timeLagMs;
  }
  const avgLagMs = totalLagMs / 16;
  console.log(`📊 Average Punch Tracking Phase Lag: ${avgLagMs.toFixed(2)} ms`);

  assert(avgLagMs < 18.0, "Kinematic Kalman Filter latency must be extremely low (under 18ms) during fast punches");
});

runTest("Verify State Extrapolation (Predictive Interpolation)", () => {
  const filter = new Kalman3DFilter();
  let now = 1000;
  const dt = 1 / 30;

  // Simulate constant velocity forward motion (along Z-axis, -0.3 units/second)
  const zVel = -0.3;
  let currentZ = 0.0;

  for (let i = 0; i < 10; i++) {
    now += dt * 1000;
    currentZ = zVel * (i * dt);
    filter.update({ x: 0.5, y: 0.4, z: currentZ }, now, 0.95);
  }

  // Now, simulate a dropped frame (lost data) and predict 33.3ms ahead
  const predicted = filter.predict(33.33); // 33.3ms = 1 frame at 30 FPS
  const targetZ = currentZ + zVel * 0.03333;

  const extrapolationError = Math.abs(predicted.z - targetZ);
  console.log(`📊 Extrapolated Position Z - Target: ${targetZ.toFixed(4)}, Predicted: ${predicted.z.toFixed(4)}, Error: ${extrapolationError.toFixed(5)}`);

  assert(extrapolationError < 0.005, "Predictive extrapolation should accurately forecast position based on estimated velocity");
});

console.log("\n⭐️ ALL MOTION SMOOTHING BENCHMARKS COMPLETED SUCCESSFULLY! Kalman tracking matches all criteria.");
