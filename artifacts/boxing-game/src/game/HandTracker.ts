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
}

export type TrackingCallback = (data: HandData) => void;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private animFrameId = 0;
  private lastTs = -1;
  private callbacks: TrackingCallback[] = [];
  private ready = false;

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.42,
      minHandPresenceConfidence: 0.42,
      minTrackingConfidence: 0.42,
    });
    this.ready = true;
  }

  async startCamera(videoEl: HTMLVideoElement): Promise<void> {
    this.video = videoEl;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960, min: 640 },
        height: { ideal: 540, min: 480 },
        frameRate: { ideal: 60, min: 24 },
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
    if (now !== this.lastTs && this.video.readyState >= 2) {
      this.lastTs = now;
      const result = this.landmarker.detectForVideo(this.video, now);
      const data = this.parseResult(result);
      this.callbacks.forEach((cb) => cb(data));
    }
    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private parseResult(result: HandLandmarkerResult): HandData {
    const data: HandData = {
      left: null,
      right: null,
      leftConfidence: 0,
      rightConfidence: 0,
      trackingConfidence: 0,
      raw: result,
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
