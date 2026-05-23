import type { Vec3 } from "../types";

export interface KalmanConfig {
  /** Jerk variance/acceleration volatility parameter (default: 0.10) */
  processNoiseVariance: number;
  /** Position sensor measurement base variance (default: 0.0035) */
  measurementNoiseBaseVariance: number;
  /** Speed exponential moving average alpha (default: 0.35) */
  speedEmaAlpha?: number;
  /** Speed threshold for deactivating static guard dampening (default: 0.14) */
  speedThreshold?: number;
  /** Slope of the measurement noise scale (default: 150.0) */
  rScaleSlope?: number;
}

export const defaultKalmanConfig: KalmanConfig = {
  processNoiseVariance: 0.10,
  measurementNoiseBaseVariance: 0.0035,
  speedEmaAlpha: 0.35,
  speedThreshold: 0.14,
  rScaleSlope: 150.0,
};

class KalmanAxisFilter {
  // State vector: [position, velocity, acceleration]
  private p = 0;
  private v = 0;
  private a = 0;

  // Covariance matrix elements (symmetric 3x3)
  private p00 = 1; private p01 = 0; private p02 = 0;
  private p11 = 1; private p12 = 0;
  private p22 = 1;

  private isInitialized = false;

  reset(): void {
    this.p = 0; this.v = 0; this.a = 0;
    this.p00 = 1; this.p01 = 0; this.p02 = 0;
    this.p11 = 1; this.p12 = 0;
    this.p22 = 1;
    this.isInitialized = false;
  }

  update(measuredPos: number, dt: number, qVar: number, rVar: number): { pos: number; vel: number; acc: number } {
    if (!this.isInitialized) {
      this.p = measuredPos;
      this.v = 0;
      this.a = 0;
      this.isInitialized = true;
      return { pos: this.p, vel: this.v, acc: this.a };
    }

    if (qVar < 0.002) {
      // Multi-Model dampening: decay velocity and acceleration states when static
      // to lock the filter into a high-suppression 1-State Position Filter
      this.v *= 0.50;
      this.a *= 0.50;
      this.p01 *= 0.15;
      this.p02 *= 0.15;
      this.p12 *= 0.15;
    }

    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt3 * dt;
    const dt5 = dt4 * dt;

    // 1. State Prediction
    const pPred = this.p + this.v * dt + 0.5 * this.a * dt2;
    const vPred = this.v + this.a * dt;
    const aPred = this.a;

    // 2. Continuous White Noise Jerk Covariance Matrix Q elements
    const q00 = qVar * (dt5 / 20);
    const q01 = qVar * (dt4 / 8);
    const q02 = qVar * (dt3 / 6);
    const q11 = qVar * (dt3 / 3);
    const q12 = qVar * (dt2 / 2);
    const q22 = qVar * dt;

    // Intermediate matrix M = F * P
    const m00 = this.p00 + dt * this.p01 + 0.5 * dt2 * this.p02;
    const m01 = this.p01 + dt * this.p11 + 0.5 * dt2 * this.p12;
    const m02 = this.p02 + dt * this.p12 + 0.5 * dt2 * this.p22;

    const m10 = this.p01 + dt * this.p02; // Using symmetry (p10 = p01)
    const m11 = this.p11 + dt * this.p12;
    const m12 = this.p12 + dt * this.p22;

    const m20 = this.p02; // Using symmetry (p20 = p02)
    const m21 = this.p12; // Using symmetry (p21 = p12)
    const m22 = this.p22;

    // Covariance Prediction P_pred = M * F^T + Q
    const pPred00 = m00 + dt * m01 + 0.5 * dt2 * m02 + q00;
    const pPred01 = m01 + dt * m02 + q01;
    const pPred02 = m02 + q02;

    const pPred11 = m11 + dt * m12 + q11;
    const pPred12 = m12 + q12;

    const pPred22 = m22 + q22;

    // 3. Measurement Update
    // Innovation Covariance S = H * P_pred * H^T + R = P_pred00 + R
    const s = pPred00 + rVar;
    const sInv = 1 / Math.max(1e-9, s);

    // Kalman Gain K = P_pred * H^T / S
    const k0 = pPred00 * sInv;
    const k1 = pPred01 * sInv; // pPred10 = pPred01
    const k2 = pPred02 * sInv; // pPred20 = pPred02

    // State Correction
    const innovation = measuredPos - pPred;
    this.p = pPred + k0 * innovation;
    this.v = vPred + k1 * innovation;
    this.a = aPred + k2 * innovation;

    // Covariance Correction P_updated = (I - K * H) * P_pred
    this.p00 = (1 - k0) * pPred00;
    this.p01 = (1 - k0) * pPred01;
    this.p02 = (1 - k0) * pPred02;

    this.p11 = pPred11 - k1 * pPred01;
    this.p12 = pPred12 - k1 * pPred02;

    this.p22 = pPred22 - k2 * pPred02;

    return { pos: this.p, vel: this.v, acc: this.a };
  }

  predict(horizonMs: number): number {
    const t = horizonMs / 1000;
    return this.p + this.v * t + 0.5 * this.a * t * t;
  }

  getVelocity(): number {
    return this.v;
  }
}

export class OneEuroVec3Filter {
  // Keeps same name as requested for a reusable module in the same package context
}

export class Kalman3DFilter {
  private readonly xFilter = new KalmanAxisFilter();
  private readonly yFilter = new KalmanAxisFilter();
  private readonly zFilter = new KalmanAxisFilter();
  private lastTs = 0;
  private smoothedSpeed = 0;
  private lastSmoothedPos: Vec3 | null = null;
  private prevSmoothedPos: Vec3 | null = null;

  constructor(private readonly config: KalmanConfig = defaultKalmanConfig) {}

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
    this.zFilter.reset();
    this.lastTs = 0;
    this.smoothedSpeed = 0;
    this.lastSmoothedPos = null;
    this.prevSmoothedPos = null;
  }

  /**
   * Updates the filter and returns the estimated position, velocity, and acceleration.
   * Measurement noise covariance is scaled dynamically based on hand detection confidence.
   */
  update(
    measured: Vec3,
    timestampMs: number,
    confidence = 0.95
  ): { position: Vec3; velocity: Vec3; acceleration: Vec3 } {
    if (this.lastTs === 0) {
      this.lastTs = timestampMs;
      this.xFilter.update(measured.x, 0.016, this.config.processNoiseVariance, this.config.measurementNoiseBaseVariance);
      this.yFilter.update(measured.y, 0.016, this.config.processNoiseVariance, this.config.measurementNoiseBaseVariance);
      this.zFilter.update(measured.z, 0.016, this.config.processNoiseVariance, this.config.measurementNoiseBaseVariance);
      
      const pos = { ...measured };
      this.lastSmoothedPos = pos;
      this.prevSmoothedPos = pos;
      return { position: pos, velocity: { x: 0, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: 0 } };
    }

    const dt = Math.max(0.001, (timestampMs - this.lastTs) / 1000);
    this.lastTs = timestampMs;

    // Dynamic measurement variance: if confidence drops below 0.65, we scale up measurement noise.
    const confidencePenalty = Math.max(0, Math.min(1, (0.65 - confidence) / 0.40));
    
    // Estimate speed from the displacement of the last two smoothed positions to filter out all high-frequency thrashes
    let instantSpeed = 0;
    if (this.lastSmoothedPos && this.prevSmoothedPos && dt > 0) {
      const distDisplacement = Math.sqrt(
        (this.lastSmoothedPos.x - this.prevSmoothedPos.x) ** 2 +
        (this.lastSmoothedPos.y - this.prevSmoothedPos.y) ** 2 +
        (this.lastSmoothedPos.z - this.prevSmoothedPos.z) ** 2
      );
      instantSpeed = distDisplacement / dt;
    }

    // Apply exponential moving average to filter out high-frequency jitter velocity spikes
    const emaAlpha = this.config.speedEmaAlpha ?? 0.35;
    this.smoothedSpeed = emaAlpha * instantSpeed + (1.0 - emaAlpha) * this.smoothedSpeed;

    // Scale up measurement noise R when static (smoothedSpeed -> 0) to maximize jitter suppression.
    // Scale R down to baseline when hand moves rapidly.
    const rScaleSlope = this.config.rScaleSlope ?? 150.0;
    const speedMeasurementScale = Math.max(1.0, 22.0 - this.smoothedSpeed * rScaleSlope);
    const rVar = this.config.measurementNoiseBaseVariance * (1.0 + confidencePenalty * 10.0) * speedMeasurementScale;

    // Threshold-gated speed scaling: if speed is below threshold, we keep Q extremely small
    // to suppress jitter. If speed is above threshold, we scale Q up to 10.0 for zero-lag tracking.
    const speedThreshold = this.config.speedThreshold ?? 0.14;
    const speedScale = this.smoothedSpeed > speedThreshold
      ? Math.min(10.0, this.smoothedSpeed * 6.0)
      : 0.0001;
    const qVar = this.config.processNoiseVariance * speedScale;

    const x = this.xFilter.update(measured.x, dt, qVar, rVar);
    const y = this.yFilter.update(measured.y, dt, qVar, rVar);
    const z = this.zFilter.update(measured.z, dt, qVar, rVar);

    const position = { x: x.pos, y: y.pos, z: z.pos };
    this.prevSmoothedPos = this.lastSmoothedPos;
    this.lastSmoothedPos = position;

    return {
      position,
      velocity: { x: x.vel, y: y.vel, z: z.vel },
      acceleration: { x: x.acc, y: y.acc, z: z.acc },
    };
  }

  /**
   * Linearly / quadratically extrapolates the estimated position forward into time.
   * Useful for predictive interpolation during high lag or visual frame drops.
   */
  predict(horizonMs: number): Vec3 {
    return {
      x: this.xFilter.predict(horizonMs),
      y: this.yFilter.predict(horizonMs),
      z: this.zFilter.predict(horizonMs),
    };
  }
}
