import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export interface HandData {
  left: NormalizedLandmark[] | null;
  right: NormalizedLandmark[] | null;
  leftConfidence: number;
  rightConfidence: number;
  trackingConfidence: number;
  raw: HandLandmarkerResult | null;
  timestampMs: number;
  videoTimeSec: number;
  inferenceMs: number;
}

export type TrackingCallback = (data: HandData) => void;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private animFrameId = 0;
  private lastVideoTime = -1;
  private lastInferenceMs = 0;
  private targetFps = 30;
  private callbacks: TrackingCallback[] = [];
  private ready = false;

  constructor(targetFps = 30) {
    this.targetFps = targetFps;
  }

  setTargetFps(fps: number): void {
    this.targetFps = Math.max(12, Math.min(60, fps));
  }

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    );
    const options = {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU" as const,
      },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.42,
      minHandPresenceConfidence: 0.42,
      minTrackingConfidence: 0.42,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options);
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
      });
    }
    this.ready = true;
  }

  async startCamera(videoEl: HTMLVideoElement): Promise<void> {
    this.video = videoEl;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640, min: 480 },
        height: { ideal: 480, min: 360 },
        frameRate: { ideal: this.targetFps, min: 24 },
        facingMode: "user",
      },
      audio: false,
    });
    videoEl.srcObject = stream;
    await new Promise<void>((res) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        res();
      };
    });
  }

  stopCamera(): void {
    if (this.video?.srcObject) {
      const tracks = (this.video.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      this.video.srcObject = null;
    }
  }

  onTrack(cb: TrackingCallback): void {
    this.callbacks.push(cb);
  }

  removeCallback(cb: TrackingCallback): void {
    this.callbacks = this.callbacks.filter((c) => c !== cb);
  }

  startTracking(): void {
    if (!this.ready || !this.video || this.running) return;
    this.running = true;
    this.loop();
  }

  stopTracking(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  private loop = (): void => {
    if (!this.running || !this.landmarker || !this.video) return;
    const now = performance.now();
    const minInterval = 1000 / this.targetFps;
    const videoTime = this.video.currentTime;
    const hasNewVideoFrame = videoTime !== this.lastVideoTime;
    if (
      this.video.readyState >= 2 &&
      hasNewVideoFrame &&
      now - this.lastInferenceMs >= minInterval
    ) {
      this.lastVideoTime = videoTime;
      this.lastInferenceMs = now;
      const start = performance.now();
      const result = this.landmarker.detectForVideo(this.video, now);
      const data = this.parseResult(result, now, videoTime, performance.now() - start);
      this.callbacks.forEach((cb) => cb(data));
    }
    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private parseResult(result: HandLandmarkerResult, timestampMs: number, videoTimeSec: number, inferenceMs: number): HandData {
    const data: HandData = {
      left: null,
      right: null,
      leftConfidence: 0,
      rightConfidence: 0,
      trackingConfidence: 0,
      raw: result,
      timestampMs,
      videoTimeSec,
      inferenceMs,
    };
    let confSum = 0;
    let confCount = 0;
    for (let i = 0; i < result.handedness.length; i++) {
      const side = result.handedness[i][0].categoryName.toLowerCase();
      const confidence = result.handedness[i][0].score ?? 0;
      // MediaPipe returns mirrored labels for selfie camera — swap them
      const actual = side === "left" ? "right" : "left";
      data[actual] = result.landmarks[i];
      if (actual === "left") data.leftConfidence = confidence;
      if (actual === "right") data.rightConfidence = confidence;
      confSum += confidence;
      confCount++;
    }
    data.trackingConfidence = confCount > 0 ? confSum / confCount : 0;
    return data;
  }

  get isReady(): boolean {
    return this.ready;
  }
}
