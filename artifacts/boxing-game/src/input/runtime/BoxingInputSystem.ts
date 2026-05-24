import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { HandTracker, type HandData } from "../../game/HandTracker";
import { PunchDetector, type HandDebugInfo, type PunchEvent } from "../../game/PunchDetector";
import { CalibrationSystem } from "../calibration/CalibrationSystem";
import { MotionFeatureExtractor } from "../motion/MotionFeatureExtractor";
import { DodgeClassifier, GuardClassifier, PunchClassifier } from "../gestures/GestureClassifiers";
import { InputResolver } from "../gestures/InputResolver";
import { defaultInputConfig, type InputSystemConfig } from "../tuning/defaultInputConfig";
import type { CombatInputEvent, DefenseType, GestureCandidate, InputCalibration, InputDiagnosticsSnapshot, InputFrameSnapshot, RawHandFrame } from "../types";

const EMPTY_DEBUG: HandDebugInfo = {
  state: "idle",
  speed: 0,
  vel: { x: 0, y: 0, z: 0 },
  lastGesture: "idle",
  confidence: 0,
  blocking: false,
  pos: { x: 0, y: 0, z: 0 },
  direction: { x: 0, y: 0, z: 0 },
  stability: 1,
  trackingConfidence: 0,
  fistConfidence: 0,
};

function isPunchType(type: GestureCandidate["type"]): type is PunchEvent["type"] {
  return type === "jab" || type === "cross" || type === "hook" || type === "uppercut" || type === "charge";
}

export class BoxingInputSystem {
  private readonly config: InputSystemConfig;
  private readonly tracker: HandTracker;
  private readonly detector = new PunchDetector();
  private readonly calibration = new CalibrationSystem();
  private readonly motion: MotionFeatureExtractor;
  private readonly punchClassifier: PunchClassifier;
  private readonly guardClassifier: GuardClassifier;
  private readonly dodgeClassifier: DodgeClassifier;
  private readonly resolver: InputResolver;
  private frameId = 0;
  private lastDiagnosticsAt = 0;
  private inferenceSamples: number[] = [];
  private inputListeners: Array<(event: CombatInputEvent) => void> = [];
  private frameListeners: Array<(snapshot: InputFrameSnapshot) => void> = [];
  private diagnosticsListeners: Array<(snapshot: InputDiagnosticsSnapshot) => void> = [];
  private lastSnapshot: InputFrameSnapshot = {
    motion: null,
    leftState: "idle",
    rightState: "idle",
    leftDebug: EMPTY_DEBUG,
    rightDebug: EMPTY_DEBUG,
    isBlocking: false,
    guardStrength: 0,
    dodge: null,
    bothHandsVisible: false,
  };

  constructor(config: Partial<InputSystemConfig> = {}) {
    this.config = { ...defaultInputConfig, ...config };
    this.tracker = new HandTracker(this.config.targetInferenceFps);
    this.motion = new MotionFeatureExtractor(this.config);
    this.punchClassifier = new PunchClassifier(this.config);
    this.guardClassifier = new GuardClassifier(this.config);
    this.dodgeClassifier = new DodgeClassifier(this.config);
    this.resolver = new InputResolver(this.config);

    this.tracker.onTrack((data) => this.process(data));
  }

  async init(): Promise<void> { await this.tracker.init(); }
  async startCamera(video: HTMLVideoElement): Promise<void> { await this.tracker.startCamera(video); }
  stopCamera(): void { this.tracker.stopCamera(); }
  startTracking(): void { this.tracker.startTracking(); }
  stopTracking(): void { this.tracker.stopTracking(); }
  dispose(): void { this.stopTracking(); this.stopCamera(); }
  startCalibration(): void { this.calibration.start(); this.motion.reset(); }
  applyCalibration(calibration: InputCalibration): void { this.calibration.set(calibration); }
  getCalibration(): InputCalibration { return this.calibration.get(); }
  getSnapshot(): InputFrameSnapshot { return this.lastSnapshot; }

  onInputEvent(listener: (event: CombatInputEvent) => void): () => void {
    this.inputListeners.push(listener);
    return () => { this.inputListeners = this.inputListeners.filter((l) => l !== listener); };
  }

  onFrame(listener: (snapshot: InputFrameSnapshot) => void): () => void {
    this.frameListeners.push(listener);
    return () => { this.frameListeners = this.frameListeners.filter((l) => l !== listener); };
  }

  onDiagnostics(listener: (snapshot: InputDiagnosticsSnapshot) => void): () => void {
    this.diagnosticsListeners.push(listener);
    return () => { this.diagnosticsListeners = this.diagnosticsListeners.filter((l) => l !== listener); };
  }

  private process(data: HandData): void {
    this.frameId++;
    this.inferenceSamples.push(data.inferenceMs);
    if (this.inferenceSamples.length > 90) this.inferenceSamples.shift();

    this.detector.update(data.left, data.right, { left: data.leftConfidence, right: data.rightConfidence, tracking: data.trackingConfidence });
    const debug = this.detector.getDebugInfo();
    const raw: RawHandFrame = {
      frameId: this.frameId,
      timestampMs: data.timestampMs,
      videoTimeSec: data.videoTimeSec,
      left: data.left,
      right: data.right,
      leftConfidence: data.leftConfidence,
      rightConfidence: data.rightConfidence,
      trackingConfidence: data.trackingConfidence,
    };
    const cal = this.calibration.update(data.left, data.right, data.timestampMs);
    const motion = this.motion.extract(raw, cal);
    const guard = this.guardClassifier.update(motion);
    const dodgeCandidate = this.dodgeClassifier.update(motion);
    const candidates: GestureCandidate[] = [];
    if (guard.candidate) candidates.push(guard.candidate);
    if (dodgeCandidate) candidates.push(dodgeCandidate);

    for (const side of ["left", "right"] as const) {
      const hand = motion.hands[side];
      if (!hand) continue;
      const candidate = this.punchClassifier.classify(hand, debug[side]);
      if (candidate) {
        candidates.push(candidate);
        const event = this.resolver.resolve(candidate, motion.frameId);
        if (event) this.emitInput(event);
      }
    }

    this.lastSnapshot = {
      motion,
      leftState: debug.left.state,
      rightState: debug.right.state,
      leftDebug: debug.left,
      rightDebug: debug.right,
      isBlocking: guard.guarding || this.detector.isBlocking(),
      guardStrength: guard.strength,
      dodge: dodgeCandidate?.type as DefenseType | null ?? null,
      bothHandsVisible: this.detector.getBothHandsVisible(),
    };
    this.frameListeners.forEach((l) => l(this.lastSnapshot));
    this.maybeEmitDiagnostics(data, candidates);
  }

  private maybeEmitDiagnostics(data: HandData, candidates: GestureCandidate[]): void {
    const minInterval = 1000 / this.config.diagnosticsFps;
    if (data.timestampMs - this.lastDiagnosticsAt < minInterval) return;
    this.lastDiagnosticsAt = data.timestampMs;
    const sorted = [...this.inferenceSamples].sort((a, b) => a - b);
    const avg = this.inferenceSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.inferenceSamples.length);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const snapshot: InputDiagnosticsSnapshot = {
      ...this.lastSnapshot,
      timestampMs: data.timestampMs,
      inferenceFps: this.config.targetInferenceFps,
      averageInferenceMs: avg,
      p95InferenceMs: p95,
      trackingQuality: data.trackingConfidence,
      calibrationConfidence: this.calibration.get().confidence,
      currentGestures: candidates,
    };
    this.diagnosticsListeners.forEach((l) => l(snapshot));
  }

  private emitInput(event: CombatInputEvent): void {
    if (!isPunchType(event.type)) return;
    this.inputListeners.forEach((l) => l(event));
  }

  getHandDots(): Array<{ x: number; y: number; hand: "left" | "right" }> {
    const dots: Array<{ x: number; y: number; hand: "left" | "right" }> = [];
    const addDots = (lm: NormalizedLandmark[] | null | undefined, hand: "left" | "right") => {
      if (!lm) return;
      [0, 4, 8, 12, 16, 20].forEach((i) => {
        if (lm[i]) dots.push({ x: (1 - lm[i].x) * 100, y: lm[i].y * 100, hand });
      });
    };
    addDots(this.lastSnapshot.motion?.hands.left?.landmarks, "left");
    addDots(this.lastSnapshot.motion?.hands.right?.landmarks, "right");
    return dots;
  }
}
