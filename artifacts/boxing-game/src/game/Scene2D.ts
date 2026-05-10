/** Fallback 2D canvas renderer when WebGL is unavailable */
export interface FighterState {
  health: number;
  isKO: boolean;
  punchAnim: { hand: "left" | "right"; t: number } | null;
  hitAnim: number;
  isBlocking: boolean;
}

export class Scene2D {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private running = false;
  private animFrameId = 0;
  private t = 0;

  private playerState: FighterState = {
    health: 100,
    isKO: false,
    punchAnim: null,
    hitAnim: 0,
    isBlocking: false,
  };
  private aiState: FighterState = {
    health: 100,
    isKO: false,
    punchAnim: null,
    hitAnim: 0,
    isBlocking: false,
  };

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");
    this.ctx = ctx;
  }

  triggerPlayerPunch(hand: "left" | "right"): void {
    this.playerState.punchAnim = { hand, t: 0 };
  }

  triggerAIPunch(hand: "left" | "right"): void {
    this.aiState.punchAnim = { hand, t: 0 };
  }

  triggerPlayerHit(): void {
    this.playerState.hitAnim = 1;
  }

  triggerAIHit(): void {
    this.aiState.hitAnim = 1;
  }

  setPlayerKO(v: boolean): void {
    this.playerState.isKO = v;
  }

  setAIKO(v: boolean): void {
    this.aiState.isKO = v;
  }

  startRendering(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stopRendering(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  resize(_w: number, _h: number): void {}

  dispose(): void {
    this.stopRendering();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);
    this.t += 0.016;
    this.render();

    // Advance punch anims
    if (this.playerState.punchAnim) {
      this.playerState.punchAnim.t += 0.1;
      if (this.playerState.punchAnim.t >= 1) this.playerState.punchAnim = null;
    }
    if (this.aiState.punchAnim) {
      this.aiState.punchAnim.t += 0.1;
      if (this.aiState.punchAnim.t >= 1) this.aiState.punchAnim = null;
    }
    if (this.playerState.hitAnim > 0) this.playerState.hitAnim -= 0.06;
    if (this.aiState.hitAnim > 0) this.aiState.hitAnim -= 0.06;
  };

  private render(): void {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0a14");
    bg.addColorStop(1, "#111128");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Ring floor
    ctx.fillStyle = "#d4b87a";
    const floorY = H * 0.72;
    const floorH = H * 0.18;
    ctx.fillRect(W * 0.08, floorY, W * 0.84, floorH);

    // Ring lines
    ctx.strokeStyle = "#aa2222";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, floorY);
    ctx.lineTo(W / 2, floorY + floorH);
    ctx.stroke();

    // Ropes
    const ropeColors = ["#cc1111", "#ffffff", "#cc1111"];
    const ropeYs = [H * 0.4, H * 0.52, H * 0.64];
    ropeYs.forEach((ry, i) => {
      ctx.strokeStyle = ropeColors[i];
      ctx.lineWidth = i === 1 ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(W * 0.06, ry);
      ctx.lineTo(W * 0.94, ry);
      ctx.stroke();
    });

    // Corner posts
    [W * 0.07, W * 0.93].forEach((px) => {
      ctx.fillStyle = "#333";
      ctx.fillRect(px - 5, H * 0.38, 10, H * 0.54);
    });

    // Draw fighters
    this.drawFighter(W * 0.28, floorY, false, this.playerState);
    this.drawFighter(W * 0.72, floorY, true, this.aiState);
  }

  private drawFighter(
    cx: number,
    floorY: number,
    isAI: boolean,
    state: FighterState
  ): void {
    const { ctx, t } = this;
    const scale = 1;
    const breathe = Math.sin(t * 1.5) * 2;
    const hitOffset = state.hitAnim > 0 ? (isAI ? -1 : 1) * state.hitAnim * 12 : 0;

    const trunkColor = isAI ? "#cc1111" : "#1155ee";
    const gloveColor = isAI ? "#ee2222" : "#2266ff";
    const skinColor = "#d4956a";

    if (state.isKO) {
      // Fallen pose
      ctx.save();
      ctx.translate(cx + (isAI ? 30 : -30), floorY - 30);
      ctx.rotate(isAI ? -1.3 : 1.3);
      ctx.fillStyle = trunkColor;
      ctx.fillRect(-18, -12, 36, 70);
      ctx.fillStyle = skinColor;
      ctx.beginPath();
      ctx.arc(0, -20, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(cx + hitOffset, 0);

    // Torso
    const torsoY = floorY - 130 + breathe * 0.3;
    ctx.fillStyle = trunkColor;
    ctx.beginPath();
    ctx.roundRect(cx - 22, torsoY, 44, 70, 6);
    ctx.fill();

    // Head
    const headY = torsoY - 40;
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(cx, headY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Helmet
    ctx.fillStyle = trunkColor;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(cx, headY - 2, 25, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx - 7, headY, 5, 0, Math.PI * 2);
    ctx.arc(cx + 7, headY, 5, 0, Math.PI * 2);
    ctx.fill();
    const eyeDir = isAI ? -4 : 4;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(cx - 7 + eyeDir * 0.5, headY, 3, 0, Math.PI * 2);
    ctx.arc(cx + 7 + eyeDir * 0.5, headY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Arms with punch animation
    const punchExt = state.punchAnim
      ? Math.sin(state.punchAnim.t * Math.PI) * 40
      : 0;
    const guardX = isAI ? -1 : 1;

    // Left glove
    const leftPunch =
      state.punchAnim?.hand === "left" ? punchExt : 0;
    const rightPunch =
      state.punchAnim?.hand === "right" ? punchExt : 0;

    // Blocking pose: hands up
    const blockY = state.isBlocking ? -30 : 0;

    ctx.fillStyle = gloveColor;
    // Left glove
    ctx.beginPath();
    ctx.arc(
      cx - 35 + leftPunch * guardX,
      torsoY + 20 + blockY,
      14,
      0,
      Math.PI * 2
    );
    ctx.fill();
    // Right glove
    ctx.beginPath();
    ctx.arc(
      cx + 35 - rightPunch * guardX,
      torsoY + 20 + blockY,
      14,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Shorts
    ctx.fillStyle = trunkColor;
    ctx.fillRect(cx - 20, torsoY + 65, 40, 35);

    // Legs
    ctx.fillStyle = skinColor;
    ctx.fillRect(cx - 18, torsoY + 95, 15, 35);
    ctx.fillRect(cx + 3, torsoY + 95, 15, 35);

    // Shoes
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - 22, torsoY + 128, 20, 10);
    ctx.fillRect(cx + 2, torsoY + 128, 20, 10);

    // Hit flash
    if (state.hitAnim > 0.3) {
      ctx.fillStyle = `rgba(255,80,20,${state.hitAnim * 0.4})`;
      ctx.beginPath();
      ctx.arc(cx, torsoY + 30, 50, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Glove sheen
    ctx.fillStyle = `rgba(255,255,255,0.2)`;
    ctx.beginPath();
    ctx.arc(cx - 35 + (state.punchAnim?.hand === "left" ? punchExt * guardX : 0) - 3, torsoY + 15 + blockY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 35 - (state.punchAnim?.hand === "right" ? punchExt * guardX : 0) - 3, torsoY + 15 + blockY, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
