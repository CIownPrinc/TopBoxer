import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandDebugInfo, HandState, PunchType } from "../game/PunchDetector";

export interface Vec3 { x: number; y: number; z: number }
export type HandSide = "left" | "right";
export type Stance = "orthodox" | "southpaw" | "unknown";
export type DefenseType = "guard" | "slip-left" | "slip-right" | "duck" | "pull-back";
export type GestureType = PunchType | DefenseType;

export interface RawHandFrame {
  frameId: number;
  timestampMs: number;
  videoTimeSec: number;
  left: NormalizedLandmark[] | null;
  right: NormalizedLandmark[] | null;
  leftConfidence: number;
  rightConfidence: number;
  trackingConfidence: number;
}

export type FrameQualityStatus =
  | "valid"
  | "low-confidence"
  | "stale"
  | "dropped"
  | "identity-ambiguous"
  | "teleport"
  | "partial";

export interface HandQuality {
  visible: boolean;
  confidence: number;
  stability: number;
  jitter: number;
  droppedFrames: number;
  status: FrameQualityStatus;
}

export interface GuardCalibration {
  leftGuard: Vec3;
  rightGuard: Vec3;
  guardCenter: Vec3;
  guardRadius: number;
  upperGuardY: number;
  lowerGuardY: number;
}

export interface BodyCalibration {
  centerLineX: number;
  headBaselineY: number;
  torsoBaselineY: number;
  shoulderWidthEstimate: number;
  userScale: number;
}

export interface ReachCalibration {
  leftReach: number;
  rightReach: number;
  maxForwardExtension: number;
}

export interface InputCalibration {
  version: number;
  stance: Stance;
  mirrorMode: boolean;
  guard: GuardCalibration;
  body: BodyCalibration;
  reach: ReachCalibration;
  createdAtMs: number;
  confidence: number;
}

export interface HandMotionSample {
  side: HandSide;
  timestampMs: number;
  rawPosition: Vec3;
  calibratedPosition: Vec3;
  smoothedPosition: Vec3;
  predictedPosition: Vec3;
  velocity: Vec3;
  smoothedVelocity: Vec3;
  acceleration: Vec3;
  speed: number;
  direction: Vec3;
  distanceFromGuard: number;
  extensionRatio: number;
  lateralRatio: number;
  verticalRatio: number;
  forwardRatio: number;
  quality: HandQuality;
  landmarks: NormalizedLandmark[];
}

export interface BodyMotionSample {
  timestampMs: number;
  center: Vec3;
  headProxy: Vec3;
  guardClusterCenter: Vec3;
  lateralOffsetFromCenter: number;
  verticalOffsetFromBaseline: number;
  leanVelocity: Vec3;
  quality: number;
}

export interface MotionFrame {
  frameId: number;
  timestampMs: number;
  hands: Partial<Record<HandSide, HandMotionSample>>;
  body: BodyMotionSample;
  calibration: InputCalibration;
  trackingConfidence: number;
}

export interface GestureCandidate {
  id: string;
  type: GestureType;
  hand?: HandSide;
  timestampMs: number;
  confidence: number;
  strength: number;
  durationMs: number;
  debugReason?: string;
}

export interface CombatInputEvent {
  id: string;
  type: PunchType;
  hand: HandSide;
  timestamp: number;
  force: number;
  confidence: number;
  stability: number;
  latencyEstimateMs: number;
  sourceFrameId: number;
}

export interface InputFrameSnapshot {
  motion: MotionFrame | null;
  leftState: HandState;
  rightState: HandState;
  leftDebug: HandDebugInfo;
  rightDebug: HandDebugInfo;
  isBlocking: boolean;
  guardStrength: number;
  dodge: DefenseType | null;
  bothHandsVisible: boolean;
}

export interface InputDiagnosticsSnapshot extends InputFrameSnapshot {
  timestampMs: number;
  inferenceFps: number;
  averageInferenceMs: number;
  p95InferenceMs: number;
  trackingQuality: number;
  calibrationConfidence: number;
  currentGestures: GestureCandidate[];
}
