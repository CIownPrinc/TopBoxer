export interface SmoothingConfig {
  emaAlpha: number;
  oneEuro: { minCutoff: number; beta: number; derivativeCutoff: number };
  alphaBeta: { alpha: number; beta: number };
  velocityWindowMs: number;
  maxPredictionMs: number;
}

export interface PunchThresholdConfig {
  minConfidence: number;
  minSpeed: number;
  minTravel: number;
  minExtension: number;
  cooldownMs: number;
  activeWindowMs: number;
  recoveryMs: number;
}

export interface PunchClassifierConfig {
  jab: PunchThresholdConfig & { maxLateralRatio: number; maxVerticalRatio: number };
  cross: PunchThresholdConfig & { minRearHandTravel: number; minCenterlineDrive: number };
  hook: PunchThresholdConfig & { minLateralRatio: number; maxForwardRatio: number };
  uppercut: PunchThresholdConfig & { minUpwardRatio: number; requiresLowerStart: boolean };
}

export interface DefenseClassifierConfig {
  guard: { enterThreshold: number; exitThreshold: number; maxHandSpeed: number; minHoldMs: number };
  dodge: { minLateralOffset: number; minVerticalOffset: number; minVelocity: number; minConfidence: number; maxDurationMs: number; recoveryMs: number };
}

export interface InputSystemConfig {
  targetInferenceFps: number;
  diagnosticsFps: number;
  camera: { width: number; height: number; frameRate: number };
  smoothing: SmoothingConfig;
  punches: PunchClassifierConfig;
  defense: DefenseClassifierConfig;
  calibration: { requiredStableFrames: number; sampleDurationMs: number; autoRefine: boolean };
}

export const defaultInputConfig: InputSystemConfig = {
  targetInferenceFps: 30,
  diagnosticsFps: 12,
  camera: { width: 640, height: 480, frameRate: 30 },
  smoothing: {
    emaAlpha: 0.46,
    oneEuro: { minCutoff: 1.25, beta: 0.075, derivativeCutoff: 1.0 },
    alphaBeta: { alpha: 0.82, beta: 0.18 },
    velocityWindowMs: 90,
    maxPredictionMs: 34,
  },
  punches: {
    jab: { minConfidence: 0.42, minSpeed: 0.25, minTravel: 0.035, minExtension: 0.18, cooldownMs: 420, activeWindowMs: 180, recoveryMs: 240, maxLateralRatio: 0.70, maxVerticalRatio: 0.82 },
    cross: { minConfidence: 0.46, minSpeed: 0.28, minTravel: 0.045, minExtension: 0.22, cooldownMs: 520, activeWindowMs: 210, recoveryMs: 280, minRearHandTravel: 0.045, minCenterlineDrive: 0.015 },
    hook: { minConfidence: 0.48, minSpeed: 0.26, minTravel: 0.045, minExtension: 0.16, cooldownMs: 560, activeWindowMs: 220, recoveryMs: 320, minLateralRatio: 0.54, maxForwardRatio: 0.78 },
    uppercut: { minConfidence: 0.48, minSpeed: 0.25, minTravel: 0.040, minExtension: 0.15, cooldownMs: 600, activeWindowMs: 240, recoveryMs: 340, minUpwardRatio: 0.52, requiresLowerStart: false },
  },
  defense: {
    guard: { enterThreshold: 0.68, exitThreshold: 0.44, maxHandSpeed: 0.42, minHoldMs: 80 },
    dodge: { minLateralOffset: 0.075, minVerticalOffset: 0.075, minVelocity: 0.22, minConfidence: 0.45, maxDurationMs: 520, recoveryMs: 260 },
  },
  calibration: { requiredStableFrames: 18, sampleDurationMs: 1200, autoRefine: true },
};
