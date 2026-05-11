/** Rich 2D canvas fallback renderer */
export class Scene2D {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private running = false;
  private animFrameId = 0;
  private t = 0;
  private dt = 0;
  private lastTime = 0;

  // Fighter state
  private pState = this.makeFighter();
  private aState = this.makeFighter();

  // Crowd dots
  private crowd: { x: number; y: number; r: number; h: string }[] = [];

  private makeFighter() {
    return {
      punchAnim: null as { hand: "left" | "right"; t: number } | null,
      hitAnim: 0,
      isKO: false,
      blocking: false,
      koAngle: 0,
    };
  }

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    this.ctx = ctx;
    // Generate crowd
    for (let i = 0; i < 80; i++) {
      this.crowd.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.004 + Math.random() * 0.006,
        h: `hsl(${Math.floor(Math.random() * 360)},70%,65%)`,
      });
    }
  }

  triggerPlayerPunch(hand: "left" | "right"): void { this.pState.punchAnim = { hand, t: 0 }; }
  triggerAIPunch(hand: "left" | "right"): void { this.aState.punchAnim = { hand, t: 0 }; }
  triggerPlayerHit(_force?: number): void { this.pState.hitAnim = 1; }
  triggerAIHit(_force?: number): void { this.aState.hitAnim = 1; }
  setPlayerKO(v: boolean): void { this.pState.isKO = v; if (!v) this.pState.koAngle = 0; }
  setAIKO(v: boolean): void { this.aState.isKO = v; if (!v) this.aState.koAngle = 0; }
  setPlayerBlocking(v: boolean): void { this.pState.blocking = v; }
  transitionToFirstPerson(): void {}
  updatePlayerHands(): void {}
  resetCamera(): void {}

  startRendering(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.loop();
  }

  stopRendering(): void { this.running = false; cancelAnimationFrame(this.animFrameId); }
  resize(_w: number, _h: number): void {}
  dispose(): void { this.stopRendering(); }

  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);
    const now = performance.now();
    this.dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.t += this.dt;

    // Advance anims
    if (this.pState.punchAnim) { this.pState.punchAnim.t += this.dt * 5; if (this.pState.punchAnim.t >= 1) this.pState.punchAnim = null; }
    if (this.aState.punchAnim) { this.aState.punchAnim.t += this.dt * 5; if (this.aState.punchAnim.t >= 1) this.aState.punchAnim = null; }
    if (this.pState.hitAnim > 0) this.pState.hitAnim = Math.max(0, this.pState.hitAnim - this.dt * 4);
    if (this.aState.hitAnim > 0) this.aState.hitAnim = Math.max(0, this.aState.hitAnim - this.dt * 4);
    if (this.pState.isKO) this.pState.koAngle = Math.min(1.45, this.pState.koAngle + this.dt * 3);
    if (this.aState.isKO) this.aState.koAngle = Math.min(1.45, this.aState.koAngle + this.dt * 3);

    this.render();
  };

  private render(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // ── Background ──────────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#08080f");
    bg.addColorStop(1, "#12122a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── Crowd (dim backdrop) ─────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.45;
    this.crowd.forEach(c => {
      ctx.fillStyle = c.h;
      ctx.beginPath();
      ctx.arc(c.x * W, c.y * H * 0.48, c.r * W, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // ── Ring ────────────────────────────────────────────────────────────────
    const ringTop  = H * 0.38;
    const ringH    = H * 0.35;
    const ringL    = W * 0.07;
    const ringR    = W * 0.93;
    const floorY   = ringTop + ringH;

    // Canvas floor with perspective gradient
    const floorGrad = ctx.createLinearGradient(0, ringTop + ringH * 0.5, 0, floorY);
    floorGrad.addColorStop(0, "#c8a85a");
    floorGrad.addColorStop(1, "#a8882a");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(ringL, ringTop + ringH * 0.55, ringR - ringL, ringH * 0.45);

    // Floor centre line
    ctx.strokeStyle = "#992222";
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.beginPath();
    ctx.moveTo(W / 2, ringTop + ringH * 0.55);
    ctx.lineTo(W / 2, floorY);
    ctx.stroke();

    // Ropes
    const ropeColors = ["#cc1111", "#ffffff", "#cc1111"];
    [0.38, 0.55, 0.72].forEach((frac, i) => {
      const ry = ringTop + ringH * frac;
      ctx.strokeStyle = ropeColors[i];
      ctx.lineWidth = i === 1 ? 3 : 2;
      ctx.shadowColor = ropeColors[i];
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(ringL, ry);
      ctx.lineTo(ringR, ry);
      ctx.stroke();
    });
    ctx.shadowBlur = 0;

    // Corner posts
    ctx.fillStyle = "#1a1a2e";
    [[ringL, ringTop], [ringR - 12, ringTop]].forEach(([px, py]) => {
      ctx.fillRect(px, py, 12, ringH + 20);
    });

    // ── Fighters ─────────────────────────────────────────────────────────────
    const midX = W / 2;
    const P1X = midX - W * 0.23;
    const P2X = midX + W * 0.23;

    this.drawFighter(P1X, floorY, false, this.pState);
    this.drawFighter(P2X, floorY, true, this.aState);

    // ── Atmosphere overlay ────────────────────────────────────────────────────
    // Vignette
    const vg = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.8);
    vg.addColorStop(0, "transparent");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Spotlight
    const sl = ctx.createRadialGradient(W/2, ringTop - 20, 10, W/2, ringTop + ringH/2, W*0.45);
    sl.addColorStop(0, "rgba(255,240,200,0.12)");
    sl.addColorStop(1, "transparent");
    ctx.fillStyle = sl;
    ctx.fillRect(0, 0, W, H);
  }

  private drawFighter(
    cx: number,
    floorY: number,
    isAI: boolean,
    s: typeof this.pState
  ): void {
    const { ctx, t } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Scale proportionally
    const scale = Math.min(W / 800, H / 600) * 0.9;
    const totalH = 180 * scale;
    const breathe = Math.sin(t * 1.5) * 2;
    const hitOffX = s.hitAnim > 0 ? (isAI ? -1 : 1) * s.hitAnim * 14 : 0;

    const trunkC = isAI ? "#aa0000" : "#0044cc";
    const gloveC = isAI ? "#dd1111" : "#1166ff";
    const skinC  = "#c8855a";

    if (s.isKO) {
      ctx.save();
      const angle = isAI ? -s.koAngle : s.koAngle;
      ctx.translate(cx + (isAI ? totalH * 0.3 : -totalH * 0.3), floorY - 35 * scale);
      ctx.rotate(angle);
      // Body
      ctx.fillStyle = trunkC;
      ctx.fillRect(-22 * scale, -totalH * 0.55, 44 * scale, totalH * 0.55);
      // Head
      ctx.fillStyle = skinC;
      ctx.beginPath();
      ctx.arc(0, -totalH * 0.65, 22 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(hitOffX, breathe * 0.4);

    const bodyW  = 44 * scale;
    const headR  = 22 * scale;
    const torsoH = 72 * scale;
    const torsoY = floorY - torsoH - 70 * scale;

    // ── Torso ──
    ctx.fillStyle = trunkC;
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & { roundRect: (x:number,y:number,w:number,h:number,r:number) => void }).roundRect?.(
      cx - bodyW / 2, torsoY, bodyW, torsoH, 6 * scale
    );
    if (!(ctx as any).roundRect) ctx.rect(cx - bodyW / 2, torsoY, bodyW, torsoH);
    ctx.fill();

    // White stripe on shirt
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(cx - bodyW * 0.15, torsoY + 4 * scale, bodyW * 0.3, torsoH - 8 * scale);

    // ── Neck ──
    ctx.fillStyle = skinC;
    ctx.fillRect(cx - 9 * scale, torsoY - 16 * scale, 18 * scale, 18 * scale);

    // ── Head ──
    ctx.fillStyle = skinC;
    ctx.beginPath();
    ctx.arc(cx, torsoY - headR - 4 * scale, headR, 0, Math.PI * 2);
    ctx.fill();

    // Face shading
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.arc(cx + (isAI ? -5 : 5) * scale, torsoY - headR - 4 * scale, headR * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // ── Helmet ──
    ctx.fillStyle = trunkC;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.arc(cx, torsoY - headR - 2 * scale, headR + 4 * scale, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    // Side guards
    [-1, 1].forEach(side => {
      ctx.beginPath();
      ctx.arc(cx + side * (headR - 2 * scale), torsoY - headR, headR * 0.55, -0.5, Math.PI + 0.5);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Helmet sheen
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx - headR * 0.3, torsoY - headR * 1.5 - 4 * scale, headR * 0.35, headR * 0.2, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // ── Shorts ──
    ctx.fillStyle = trunkC;
    const shortsY = torsoY + torsoH;
    ctx.fillRect(cx - bodyW * 0.48, shortsY, bodyW * 0.96, 36 * scale);
    // Shorts stripe
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(cx - 4 * scale, shortsY + 4 * scale, 8 * scale, 28 * scale);

    // ── Legs ──
    ctx.fillStyle = skinC;
    ctx.fillRect(cx - bodyW * 0.4, shortsY + 34 * scale, 18 * scale, 38 * scale);
    ctx.fillRect(cx + bodyW * 0.22, shortsY + 34 * scale, 18 * scale, 38 * scale);

    // ── Shoes ──
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(cx - bodyW * 0.44, shortsY + 70 * scale, 22 * scale, 11 * scale);
    ctx.fillRect(cx + bodyW * 0.2, shortsY + 70 * scale, 22 * scale, 11 * scale);

    // ── Arms & gloves ──
    const punchExt = s.punchAnim
      ? Math.sin(s.punchAnim.t * Math.PI) * 46 * scale
      : 0;
    const guardDir = isAI ? -1 : 1;
    const armY     = torsoY + 22 * scale;
    const blockY   = s.blocking ? -28 * scale : 0;

    const leftExt  = s.punchAnim?.hand === "left"  ? punchExt : 0;
    const rightExt = s.punchAnim?.hand === "right" ? punchExt : 0;

    // Left glove
    const lgx = cx - 38 * scale + leftExt  * guardDir;
    const lgy = armY + blockY;
    ctx.fillStyle = gloveC;
    ctx.beginPath();
    ctx.ellipse(lgx, lgy, 15 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    // Glove sheen
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.ellipse(lgx - 4 * scale, lgy - 4 * scale, 5 * scale, 3 * scale, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // Right glove
    const rgx = cx + 38 * scale - rightExt * guardDir;
    const rgy = armY + blockY;
    ctx.fillStyle = gloveC;
    ctx.beginPath();
    ctx.ellipse(rgx, rgy, 15 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.ellipse(rgx - 4 * scale, rgy - 4 * scale, 5 * scale, 3 * scale, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // ── Hit flash ──
    if (s.hitAnim > 0.25) {
      ctx.fillStyle = `rgba(255,100,20,${s.hitAnim * 0.35})`;
      ctx.beginPath();
      ctx.arc(cx, torsoY + torsoH * 0.4, 55 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Impact star lines
      ctx.strokeStyle = `rgba(255,200,50,${s.hitAnim * 0.8})`;
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + t;
        const r = (35 + s.hitAnim * 25) * scale;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * 15 * scale, torsoY + torsoH * 0.4 + Math.sin(angle) * 15 * scale);
        ctx.lineTo(cx + Math.cos(angle) * r, torsoY + torsoH * 0.4 + Math.sin(angle) * r);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
