/**
 * ThreeScene — VR-style 3D boxing arena
 *
 * Fighter layout (Z axis):
 *   Player at z=+2.5, rotated π (faces -Z toward AI)
 *   AI     at z=-2.5, rotation 0  (faces +Z toward player)
 *
 * Camera modes:
 *   third-person  — elevated behind player
 *   transitioning — smooth 2.6-second cinematic fly-in to FP
 *   first-person  — player eye-level, FP gloves visible as camera children
 */
import * as THREE from "three";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandState } from "./PunchDetector";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

type CameraMode = "third-person" | "transitioning" | "first-person";

interface FighterMeshes {
  group:      THREE.Group;
  torso:      THREE.Mesh;
  head:       THREE.Mesh;
  leftArm:    THREE.Group;
  rightArm:   THREE.Group;
  leftGlove:  THREE.Mesh;
  rightGlove: THREE.Mesh;
}

interface HitEffect { mesh: THREE.Mesh; born: number; duration: number; maxOp: number }

interface FPArms {
  group:      THREE.Group;
  leftGlove:  THREE.Mesh;
  rightGlove: THREE.Mesh;
  leftArm:    THREE.Mesh;
  rightArm:   THREE.Mesh;
}

function smootherstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

// ── Layout ────────────────────────────────────────────────────────────────────
const PLAYER_Z =  2.5;
const AI_Z     = -2.5;

const TP_POS    = new THREE.Vector3(0, 5.0, 9.5);
const FP_POS    = new THREE.Vector3(0, 1.75, 1.65);
const TP_LOOKAT = new THREE.Vector3(0, 1.40, 0);
const FP_LOOKAT = new THREE.Vector3(0, 1.55, AI_Z);

export class ThreeScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!:    THREE.Scene;
  private camera!:   THREE.PerspectiveCamera;
  private player!:   FighterMeshes;
  private ai!:       FighterMeshes;
  private referee!:  FighterMeshes;

  // ── Camera ────────────────────────────────────────────────────────────────
  private cameraMode: CameraMode = "third-person";
  private fpTransStart  = 0;
  private readonly FP_TRANS_MS = 2600;
  private fpTransStartPos  = new THREE.Vector3();
  private fpTransStartQuat = new THREE.Quaternion();
  private fpTargetQuat     = new THREE.Quaternion();

  // ── First-person arms ──────────────────────────────────────────────────────
  private fpArms!:     FPArms;
  private fpFlashMat!: THREE.MeshBasicMaterial;
  private flashOpacity = 0;

  private leftEchoes:  THREE.Mesh[] = [];
  private rightEchoes: THREE.Mesh[] = [];
  private prevLPos          = new THREE.Vector3();
  private prevRPos          = new THREE.Vector3();
  private leftTrailOpacity  = 0;
  private rightTrailOpacity = 0;

  // Camera-local targets / current positions for FP gloves
  private fpLTarget  = new THREE.Vector3(-0.38, -0.38, -0.82);
  private fpRTarget  = new THREE.Vector3( 0.38, -0.38, -0.82);
  private fpLCurrent = new THREE.Vector3(-0.38, -0.38, -0.82);
  private fpRCurrent = new THREE.Vector3( 0.38, -0.38, -0.82);

  // ── Animation ─────────────────────────────────────────────────────────────
  private lastRafTime = 0;
  private animTime    = 0;
  private slowMo      = 0;
  private running     = false;
  private animFrameId = 0;

  private playerPunch: { hand: "left" | "right"; t: number } | null = null;
  private aiPunch:     { hand: "left" | "right"; t: number } | null = null;
  private playerHit   = 0;
  private aiHit       = 0;
  private playerKO    = false;
  private aiKO        = false;
  private playerBlock = false;
  private cameraShake = 0;
  private refereeSignal: "idle" | "counting" | "fight" = "idle";

  private hitEffects: HitEffect[] = [];

  // Dynamic Camera Controller State properties for premium arcade feel
  private camCurrentPos = new THREE.Vector3().copy(TP_POS);
  private camTargetPos  = new THREE.Vector3().copy(TP_POS);
  private camCurrentLookAt = new THREE.Vector3().copy(TP_LOOKAT);
  private camTargetLookAt  = new THREE.Vector3().copy(TP_LOOKAT);
  private camBaseFov = 58;
  private camCurrentFov = 58;
  private camCurrentRoll = 0;
  private camTargetRoll = 0;
  private playerDodgeType: string | null = null;

  // Post-processing & Particle System properties
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private sparkParticles!: THREE.InstancedMesh;
  private sparkData: Array<{ active: boolean; birth: number; life: number; pos: THREE.Vector3; vel: THREE.Vector3 }> = [];
  private readonly MAX_SPARKS = 200;
  private sparkIndex = 0;

  // ── Public API ─────────────────────────────────────────────────────────────
  tryInit(canvas: HTMLCanvasElement): boolean {
    try { this.init(canvas); return true; } catch { return false; }
  }

  init(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth  || 800;
    const h = canvas.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, failIfMajorPerformanceCaveat: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap; // Beautiful soft shadows
    this.renderer.setSize(w, h);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060A);
    this.scene.fog = new THREE.FogExp2(0x05060A, 0.036);

    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.05, 120);
    this.camera.position.copy(TP_POS);
    this.camera.lookAt(TP_LOOKAT);

    // Pre-compute FP target quaternion
    {
      const tmp = new THREE.PerspectiveCamera();
      tmp.position.copy(FP_POS);
      tmp.lookAt(FP_LOOKAT);
      this.fpTargetQuat.copy(tmp.quaternion);
    }

    this.buildArena();
    this.buildLights();

    this.player = this.buildFighter(false);
    this.ai     = this.buildFighter(true);
    this.referee = this.buildFighter(false);
    this.player.group.position.set(0, 0, PLAYER_Z);
    this.player.group.rotation.y = Math.PI; // faces -Z toward AI
    this.ai.group.position.set(0, 0, AI_Z);
    this.ai.group.rotation.y = 0;           // faces +Z toward player
    this.referee.group.position.set(0, 0, -0.5);
    this.referee.group.scale.setScalar(0.82);

    // FP arms (camera children, hidden until FP mode activated)
    this.fpArms = this.buildFPArms();
    this.fpArms.group.visible = false;

    // Hit flash plane (camera child, fullscreen-ish quad)
    this.fpFlashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false,
    });
    const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), this.fpFlashMat);
    flashMesh.position.z = -1.8;
    flashMesh.renderOrder = 9999;

    this.camera.add(this.fpArms.group);
    this.camera.add(flashMesh);
    this.scene.add(this.camera); // required so camera children render

    // ── Post-processing Pipeline Setup (WebGL 2 HDR) ─────────────────────────
    const renderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    
    // 1. Render Pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // 2. Bloom Pass (glowing ropes, spotlights, hit sparks)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.35, 0.45, 0.85);
    this.composer.addPass(this.bloomPass);

    // 3. Custom Vignette & Chromatic Aberration Pass
    const vignetteShader = {
      name: "VignetteChromaticShader",
      uniforms: {
        tDiffuse: { value: null },
        uVignetteDarkness: { value: 1.1 },
        uVignetteOffset: { value: 0.95 },
        uChromaticAberration: { value: 0.0022 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uVignetteDarkness;
        uniform float uVignetteOffset;
        uniform float uChromaticAberration;
        varying vec2 vUv;
        void main() {
          vec4 cr = texture2D(tDiffuse, vUv + vec2(uChromaticAberration, 0.0));
          vec4 cg = texture2D(tDiffuse, vUv);
          vec4 cb = texture2D(tDiffuse, vUv - vec2(uChromaticAberration, 0.0));
          vec4 color = vec4(cr.r, cg.g, cb.b, cg.a);

          vec2 uv = vUv - 0.5;
          float d = length(uv);
          float vignette = smoothstep(uVignetteOffset, uVignetteOffset - uVignetteDarkness, d);
          color.rgb *= vignette;

          gl_FragColor = color;
        }
      `
    };
    const gradingPass = new ShaderPass(vignetteShader);
    this.composer.addPass(gradingPass);

    // 4. Output Pass (ACES Filmic Tone Mapping + sRGB conversion)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // ── GPU Instanced Spark Particles Setup ───────────────────────────────────
    const sparkGeo = new THREE.BoxGeometry(0.038, 0.038, 0.038);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      toneMapped: false, // Bypass tone mapping for neon glow
    });
    this.sparkParticles = new THREE.InstancedMesh(sparkGeo, sparkMat, this.MAX_SPARKS);
    this.sparkParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const tempMatrix = new THREE.Matrix4().makeTranslation(9999, 9999, 9999);
    for (let i = 0; i < this.MAX_SPARKS; i++) {
      this.sparkParticles.setMatrixAt(i, tempMatrix);
      this.sparkData.push({
        active: false,
        birth: 0,
        life: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }
    this.scene.add(this.sparkParticles);
  }

  // ── First-person controls ─────────────────────────────────────────────────
  transitionToFirstPerson(): void {
    if (this.cameraMode !== "third-person") return;
    this.cameraMode = "transitioning";
    this.fpTransStart = performance.now();
    this.fpTransStartPos.copy(this.camera.position);
    this.fpTransStartQuat.copy(this.camera.quaternion);
  }

  updatePlayerHands(
    left:  NormalizedLandmark[] | null,
    right: NormalizedLandmark[] | null,
    leftState:  HandState,
    rightState: HandState,
  ): void {
    if (this.cameraMode !== "first-person") return;

    const PUNCH_Z = -1.35; // extended toward AI
    const REST_Z  = -0.82; // guard position
    const COCK_Z  = -0.52; // pulled back for charge

    const updateGlove = (
      lm: NormalizedLandmark[],
      state: HandState,
      target: THREE.Vector3,
      baseX: number,
    ): void => {
      const my   = lm[0].y;
      const mx   = lm[0].x;
      const yAdj = -(my - 0.45) * 0.28;
      // Mirror MediaPipe X for selfie-cam: screen-right = camera-right
      const xAdj = baseX > 0
        ? -(mx - 0.5) * 0.12   // right glove
        : (mx - 0.5) * 0.12;   // left glove
      target.set(
        baseX + xAdj,
        -0.38 + yAdj,
        state === "strike" || state === "punching" ? PUNCH_Z : state === "windup" || state === "cocking" ? COCK_Z : REST_Z,
      );
    };

    if (left)  updateGlove(left,  leftState,  this.fpLTarget, -0.38);
    else       this.fpLTarget.set(-0.38, -0.38, REST_Z);

    if (right) updateGlove(right, rightState, this.fpRTarget,  0.38);
    else       this.fpRTarget.set( 0.38, -0.38, REST_Z);
  }

  setRefereeState(phase: "idle" | "counting" | "fight"): void {
    this.refereeSignal = phase;
  }

  resetCamera(): void {
    this.cameraMode = "third-person";
    this.camera.position.copy(TP_POS);
    this.camera.lookAt(TP_LOOKAT);
    this.fpArms.group.visible = false;
    this.player.group.visible = true;
    this.fpLCurrent.set(-0.38, -0.38, -0.82);
    this.fpRCurrent.set( 0.38, -0.38, -0.82);
    this.fpLTarget.set(-0.38, -0.38, -0.82);
    this.fpRTarget.set( 0.38, -0.38, -0.82);
    this.cameraShake  = 0;
    this.slowMo       = 0;
    this.flashOpacity = 0;
    if (this.fpFlashMat) this.fpFlashMat.opacity = 0;
    this.leftTrailOpacity = 0;
    this.rightTrailOpacity = 0;
    for (const e of this.leftEchoes) e.visible = false;
    for (const e of this.rightEchoes) e.visible = false;
  }

  // ── Combat triggers ───────────────────────────────────────────────────────
  triggerPlayerPunch(hand: "left" | "right"): void {
    this.playerPunch = { hand, t: 0 };
  }

  triggerAIPunch(hand: "left" | "right"): void {
    this.aiPunch = { hand, t: 0 };
  }

  triggerPlayerHit(force = 0.5): void {
    this.playerHit  = 1;
    this.cameraShake = Math.max(this.cameraShake, force * 1.1);
    this.camCurrentFov = this.camBaseFov - 12 * force; // Instant impact zoom!
    this.spawnHit(new THREE.Vector3(0, 1.6, PLAYER_Z));
    if (this.cameraMode === "first-person") {
      this.fpFlashMat.color.setHex(0xff4400);
      this.flashOpacity = Math.max(this.flashOpacity, 0.35 + force * 0.35);
    }
  }

  triggerAIHit(force = 0.5): void {
    this.aiHit = 1;
    this.camCurrentFov = this.camBaseFov - 10 * force; // Instant impact zoom!
    this.spawnHit(new THREE.Vector3(0, 1.6, AI_Z));
    // Slow-mo + white flash for strong hits
    if (force >= 0.70) {
      this.slowMo = Math.max(this.slowMo, force * 0.88);
      if (this.cameraMode === "first-person") {
        this.fpFlashMat.color.setHex(0xffffff);
        this.flashOpacity = Math.max(this.flashOpacity, 0.25 + force * 0.30);
      }
    }
  }

  setPlayerKO(v: boolean): void      { this.playerKO    = v; }
  setAIKO(v: boolean): void          { this.aiKO        = v; }
  setPlayerBlocking(v: boolean): void { this.playerBlock = v; }
  setPlayerDodge(type: string | null): void { this.playerDodgeType = type; }
  setPlayerExhausted(v: boolean): void {}
  setAIExhausted(v: boolean): void {}
  setPlayerStunned(v: boolean): void {}
  setAIStunned(v: boolean): void {}

  startRendering(): void {
    if (this.running) return;
    this.running = true;
    this.lastRafTime = performance.now() / 1000;
    this.renderLoop();
  }

  stopRendering(): void { this.running = false; cancelAnimationFrame(this.animFrameId); }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
    }
  }

  dispose(): void { this.stopRendering(); this.renderer.dispose(); }

  // ── Arena ──────────────────────────────────────────────────────────────────
  private buildArena(): void {
    // Floor
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd4b870, roughness: 0.90, metalness: 0.02 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 10), floorMat);
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Centre line
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xaa1111 });
    const line = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.02, 0.07), lineMat);
    line.position.set(0, 0.001, 0);
    this.scene.add(line);

    // Corner posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x16162a, roughness: 0.22, metalness: 0.80 });
    for (const [px, pz] of [[-4.5,-4.5],[4.5,-4.5],[-4.5,4.5],[4.5,4.5]] as [number,number][]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.8, 10), postMat);
      post.position.set(px, 1.9, pz);
      post.castShadow = true;
      this.scene.add(post);
    }

    // Ropes (3 heights)
    for (const h of [0.75, 1.55, 2.35]) {
      const clr = h === 1.55 ? 0xeeeeee : 0xcc1111;
      const rm  = new THREE.MeshStandardMaterial({ color: clr, roughness: 0.45, metalness: 0.25 });
      for (const pz of [-4.5, 4.5]) {
        const g = new THREE.CylinderGeometry(0.045, 0.045, 9.1, 8); g.rotateZ(Math.PI / 2);
        const r = new THREE.Mesh(g, rm); r.position.set(0, h, pz); this.scene.add(r);
      }
      for (const px of [-4.5, 4.5]) {
        const g = new THREE.CylinderGeometry(0.045, 0.045, 9.1, 8); g.rotateX(Math.PI / 2);
        const r = new THREE.Mesh(g, rm); r.position.set(px, h, 0); this.scene.add(r);
      }
    }

    // Crowd backdrop (main + sides)
    const mkBackdrop = (w: number, h: number, pos: THREE.Vector3Like, rotY = 0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: 0x09091e, side: THREE.DoubleSide }),
      );
      m.position.set(pos.x, pos.y, pos.z);
      m.rotation.y = rotY;
      this.scene.add(m);
    };
    mkBackdrop(44, 18, { x: 0,    y: 7, z: -14 });
    mkBackdrop(16, 18, { x: -15, y: 7, z: 0   },  Math.PI / 2);
    mkBackdrop(16, 18, { x:  15, y: 7, z: 0   }, -Math.PI / 2);

    // Crowd dots
    const rng = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < 120; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(rng(0.04, 0.10), 4, 4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.9, rng(0.55, 0.85)) }),
      );
      const ang = Math.random() * Math.PI * 2;
      const rad = rng(6, 16);
      dot.position.set(Math.cos(ang) * rad, rng(1, 12), Math.sin(ang) * rad - 4);
      if (dot.position.z > 8) dot.position.z = 8; // keep behind ring
      this.scene.add(dot);
    }
  }

  // ── Lights ────────────────────────────────────────────────────────────────
  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x223366, 2.2));

    // Main arena spot
    const spot = new THREE.SpotLight(0xfff5dd, 7, 32, Math.PI / 4.2, 0.28, 1.0);
    spot.position.set(0, 14, 2);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far  = 32;
    this.scene.add(spot, spot.target);

    // Corner accent lights
    const blueRim = new THREE.PointLight(0x3366ff, 4.2, 15);
    blueRim.position.set(-4.5, 5, PLAYER_Z);
    this.scene.add(blueRim);
    const redRim = new THREE.PointLight(0xff3311, 4.2, 15);
    redRim.position.set(4.5, 5, AI_Z);
    this.scene.add(redRim);

    // Front fill (good for TP camera)
    const fill = new THREE.DirectionalLight(0xffeedd, 1.5);
    fill.position.set(0, 6, 10);
    fill.target.position.set(0, 1, 0);
    this.scene.add(fill, fill.target);

    // Back accent (AI drama in FP view)
    const backAccent = new THREE.PointLight(0xff6600, 2.5, 10);
    backAccent.position.set(0, 6, AI_Z - 3.5);
    this.scene.add(backAccent);

    // Rim under-ring glow
    const rimGlow = new THREE.PointLight(0x8833ff, 1.5, 8);
    rimGlow.position.set(0, -0.5, 0);
    this.scene.add(rimGlow);
  }

  // ── Fighter builder ───────────────────────────────────────────────────────
  private buildFighter(isAI: boolean): FighterMeshes {
    const g = new THREE.Group();

    const trunkColor = isAI ? 0x161722 : 0x002299;
    const gloveColor = isAI ? 0xCCFF00 : 0x0033cc;
    const skinColor  = isAI ? 0x0D0E15 : 0xc88850;

    const skinM   = new THREE.MeshStandardMaterial({ color: skinColor,  roughness: 0.42, metalness: 0.10 }); // Sweaty dynamic skin
    const trunkM  = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.38, metalness: 0.20 });
    const gloveM  = new THREE.MeshStandardMaterial({
      color: gloveColor,
      emissive: isAI ? 0xCCFF00 : 0x000000,
      emissiveIntensity: isAI ? 0.35 : 0.0,
      roughness: 0.18,
      metalness: 0.40,
    }); // Shiny leather gloves
    const shoeM   = new THREE.MeshStandardMaterial({ color: 0x080808,   roughness: 0.88, metalness: 0.08 });
    const helmetM = new THREE.MeshStandardMaterial({
      color: trunkColor, roughness: 0.18, metalness: 0.50, transparent: true, opacity: 0.82,
    });

    const tw = isAI ? 0.92 : 0.78; // torso width

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.92, 0.46), trunkM);
    torso.position.y = 0.88; torso.castShadow = true; g.add(torso);

    // Collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.33, 0.16, 12), trunkM);
    collar.position.y = 1.34; g.add(collar);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.24, 12), skinM);
    neck.position.y = 1.46; g.add(neck);

    // Head
    const headR = isAI ? 0.31 : 0.27;
    const head  = new THREE.Mesh(new THREE.SphereGeometry(headR, 18, 18), skinM);
    head.position.y = 1.67; head.castShadow = true; g.add(head);

    // Helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(headR + 0.055, 18, 18), helmetM);
    helmet.position.y = 1.70; helmet.scale.y = 0.87; g.add(helmet);

    // Face details (AI only — angry eyes, nose, V-brows)
    if (isAI) {
      const eyeM  = new THREE.MeshStandardMaterial({
        color: 0xCCFF00,
        emissive: 0xCCFF00,
        emissiveIntensity: 0.8,
        roughness: 1.0,
      });
      const browM = new THREE.MeshStandardMaterial({ color: 0x161722, roughness: 0.8 });
      const fwdZ  = -(headR - 0.06); // front of head in local space

      for (const [sx, bRot] of [[-0.10,  0.33], [0.10, -0.33]] as [number, number][]) {
        const eye  = new THREE.Mesh(new THREE.SphereGeometry(0.044, 8, 8), eyeM);
        eye.position.set(sx, 1.70, fwdZ); g.add(eye);

        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.036, 0.050), browM);
        brow.position.set(sx, 1.78, fwdZ - 0.01);
        brow.rotation.z = bRot; g.add(brow);
      }
      const nose  = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.055, 0.075), skinM);
      nose.position.set(0, 1.66, fwdZ - 0.005); g.add(nose);

      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.04), browM);
      mouth.position.set(0, 1.60, fwdZ - 0.005); g.add(mouth);
    }

    // Arms
    const makeArm = (side: number): THREE.Group => {
      const arm = new THREE.Group();
      arm.position.set(side * (isAI ? 0.53 : 0.46), 1.02, 0);

      const ur = isAI ? 0.118 : 0.103;
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(ur, ur * 0.86, 0.58, 12), skinM);
      upper.rotation.z = -side * 0.22; upper.castShadow = true; arm.add(upper);

      const fr = isAI ? 0.092 : 0.082;
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(fr, fr * 0.82, 0.50, 12), skinM);
      fore.position.set(side * 0.11, -0.46, 0.22); fore.rotation.x = 0.30;
      fore.castShadow = true; arm.add(fore);

      const gr = isAI ? 0.198 : 0.168;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(gr, 16, 16), gloveM);
      glove.scale.set(1.0, 0.77, 1.34);
      glove.position.set(side * 0.12, -0.73, 0.45);
      glove.castShadow = true; arm.add(glove);

      return arm;
    };

    const leftArm  = makeArm(-1);
    const rightArm = makeArm(1);
    g.add(leftArm, rightArm);
    const leftGlove  = leftArm.children[2]  as THREE.Mesh;
    const rightGlove = rightArm.children[2] as THREE.Mesh;

    // Hips
    const hips = new THREE.Mesh(new THREE.BoxGeometry(tw * 0.92, 0.46, 0.42), trunkM);
    hips.position.y = 0.30; hips.castShadow = true; g.add(hips);

    // Legs
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.105, 0.60, 12), skinM);
      thigh.position.set(side * 0.21, -0.02, 0); thigh.castShadow = true; g.add(thigh);

      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.090, 0.073, 0.56, 12), skinM);
      shin.position.set(side * 0.20, -0.47, 0.05); shin.rotation.x = 0.07; g.add(shin);

      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.42), shoeM);
      shoe.position.set(side * 0.20, -0.79, 0.11); g.add(shoe);
    }

    this.scene.add(g);
    return { group: g, torso, head, leftArm, rightArm, leftGlove, rightGlove };
  }

  // ── First-person boxing gloves ─────────────────────────────────────────────
  private buildFPArms(): FPArms {
    const group = new THREE.Group();

    // depthTest:false so gloves always draw in front of the scene
    const leftGloveMat = new THREE.MeshStandardMaterial({
      color: 0x00F0FF, emissive: 0x00F0FF, emissiveIntensity: 0.8, roughness: 0.18, metalness: 0.40,
      depthTest: false, depthWrite: false,
    });
    const rightGloveMat = new THREE.MeshStandardMaterial({
      color: 0xFF0055, emissive: 0xFF0055, emissiveIntensity: 0.8, roughness: 0.18, metalness: 0.40,
      depthTest: false, depthWrite: false,
    });
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x12131C, roughness: 0.30, metalness: 0.60,
      depthTest: false, depthWrite: false,
    });

    const mkGlove = (mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.27), mat);
      m.renderOrder = 900; return m;
    };
    const mkArm = (): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.097, 0.54, 12), armMat);
      m.rotation.x = -Math.PI / 2; m.renderOrder = 900; return m;
    };

    const leftGlove  = mkGlove(leftGloveMat); leftGlove.position.set( -0.38, -0.38, -0.82);
    const rightGlove = mkGlove(rightGloveMat); rightGlove.position.set( 0.38, -0.38, -0.82);
    const leftArm    = mkArm();   leftArm.position.set(   -0.38, -0.32, -0.60);
    const rightArm   = mkArm();   rightArm.position.set(   0.38, -0.32, -0.60);

    group.add(leftGlove, rightGlove, leftArm, rightArm);

    // Pre-allocate 8 wireframe box echoes per glove
    const geom = new THREE.BoxGeometry(0.20, 0.14, 0.27);
    this.leftEchoes = [];
    this.rightEchoes = [];

    for (let i = 0; i < 8; i++) {
      const leftEchoMat = new THREE.MeshBasicMaterial({
        color: 0x00F0FF,
        transparent: true,
        opacity: 0,
        wireframe: true,
        depthTest: false,
        depthWrite: false,
      });
      const leftEchoMesh = new THREE.Mesh(geom, leftEchoMat);
      leftEchoMesh.renderOrder = 899;
      leftEchoMesh.position.copy(leftGlove.position);
      group.add(leftEchoMesh);
      this.leftEchoes.push(leftEchoMesh);

      const rightEchoMat = new THREE.MeshBasicMaterial({
        color: 0xFF0055,
        transparent: true,
        opacity: 0,
        wireframe: true,
        depthTest: false,
        depthWrite: false,
      });
      const rightEchoMesh = new THREE.Mesh(geom, rightEchoMat);
      rightEchoMesh.renderOrder = 899;
      rightEchoMesh.position.copy(rightGlove.position);
      group.add(rightEchoMesh);
      this.rightEchoes.push(rightEchoMesh);
    }

    return { group, leftGlove, rightGlove, leftArm, rightArm };
  }

  // ── Hit effects ────────────────────────────────────────────────────────────
  private triggerSparks(pos: THREE.Vector3, count = 28): void {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const idx = this.sparkIndex;
      this.sparkIndex = (this.sparkIndex + 1) % this.MAX_SPARKS;

      const data = this.sparkData[idx];
      data.active = true;
      data.birth = now;
      data.life = 350 + Math.random() * 350; // 350-700ms lifespan
      data.pos.copy(pos);
      
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 3.5;
      const verticalSpeed = 0.5 + Math.random() * 4.5;
      data.vel.set(
        Math.cos(angle) * speed,
        verticalSpeed,
        Math.sin(angle) * speed
      );
    }
  }

  private spawnHit(pos: THREE.Vector3): void {
    this.triggerSparks(pos);

    // Star burst wireframe
    const burst = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.40, 0),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.95, wireframe: true }),
    );
    burst.position.copy(pos);
    burst.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    this.scene.add(burst);
    this.hitEffects.push({ mesh: burst, born: performance.now(), duration: 380, maxOp: 0.95 });

    // Ring shockwave (torus)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.042, 8, 18),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 }),
    );
    ring.position.copy(pos);
    ring.lookAt(this.camera.position);
    this.scene.add(ring);
    this.hitEffects.push({ mesh: ring, born: performance.now(), duration: 310, maxOp: 0.78 });
  }

  private updateHitEffects(): void {
    const now = performance.now();
    this.hitEffects = this.hitEffects.filter(({ mesh, born, duration, maxOp }) => {
      const t = (now - born) / duration;
      if (t >= 1) { this.scene.remove(mesh); return false; }
      mesh.scale.setScalar(1 + t * 3.8);
      (mesh.material as THREE.MeshBasicMaterial).opacity = maxOp * (1 - t);
      return true;
    });
  }

  // ── Fighter animation ─────────────────────────────────────────────────────
  private animateFighter(
    f: FighterMeshes,
    t: number,
    punch: { hand: "left" | "right"; t: number } | null,
    hit: number,
    isKO: boolean,
    isAI: boolean,
    blocking: boolean,
  ): { hand: "left" | "right"; t: number } | null {
    const { group, torso, head, leftArm, rightArm } = f;
    const baseZ = isAI ? AI_Z : PLAYER_Z;

    // KO fall
    if (isKO) {
      const fallDir = isAI ? 1.55 : -1.55;
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, fallDir, 0.055);
      group.position.y = THREE.MathUtils.lerp(group.position.y, -0.55, 0.055);
      return null;
    }
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, 0, 0.10);
    group.position.y = THREE.MathUtils.lerp(group.position.y, 0, 0.10);

    // Breathing idle
    torso.scale.y    = 1 + Math.sin(t * 1.35) * 0.022;
    head.position.y  = 1.67 + Math.sin(t * 1.35) * 0.012;

    // Guard / block pose
    const guardX = blocking ? 0.95 : 0.30;
    const blockY = blocking ? -0.28 : 0;
    leftArm.rotation.x  = THREE.MathUtils.lerp(leftArm.rotation.x,  guardX, 0.12);
    rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, guardX, 0.12);
    leftArm.position.z  = THREE.MathUtils.lerp(leftArm.position.z,  blocking ? 0.36 : 0, 0.12);
    rightArm.position.z = THREE.MathUtils.lerp(rightArm.position.z, blocking ? 0.36 : 0, 0.12);
    leftArm.position.y  = THREE.MathUtils.lerp(leftArm.position.y,  blockY, 0.12);
    rightArm.position.y = THREE.MathUtils.lerp(rightArm.position.y, blockY, 0.12);

    // Hit stagger — more dramatic in FP for the AI
    if (hit > 0.06) {
      const mag = (this.cameraMode === "first-person" && isAI) ? 0.32 : 0.18;
      head.position.x  = Math.sin(hit * Math.PI) * mag * (isAI ? 1 : -1);
      // Body recoils: AI goes further from player, player staggers back
      const recoilZ = isAI ? (baseZ - hit * 0.48) : (baseZ + hit * 0.36);
      group.position.z = THREE.MathUtils.lerp(group.position.z, recoilZ, 0.16);
      group.rotation.x = isAI ? hit * -0.20 : hit * 0.15;
    } else {
      head.position.x  = THREE.MathUtils.lerp(head.position.x,  0,     0.20);
      group.position.z = THREE.MathUtils.lerp(group.position.z, baseZ, 0.08);
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x,  0,     0.12);
    }

    // Punch extension
    if (punch) {
      punch.t = Math.min(1, punch.t + 0.13);
      const arm  = punch.hand === "left" ? leftArm : rightArm;
      const ext  = Math.sin(punch.t * Math.PI);
      const side = punch.hand === "left" ? -1 : 1;
      arm.rotation.x = guardX + ext * 1.70;
      arm.rotation.z = ext * side * 0.40;
      arm.position.z = ext * 0.58;
      if (punch.t >= 1) return null;
    }

    return punch;
  }

  // ── Render loop ────────────────────────────────────────────────────────────
  private renderLoop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.renderLoop);

    const now      = performance.now();
    const realDelta = Math.min((now - (this.lastRafTime || now)) / 1000, 0.05);
    this.lastRafTime = now;
    const animDelta = realDelta * (1 - this.slowMo * 0.82);
    this.animTime  += animDelta;
    const t         = this.animTime;

    this.slowMo = Math.max(0, this.slowMo - 0.022);

    // Flash fade
    if (this.flashOpacity > 0) {
      this.flashOpacity = Math.max(0, this.flashOpacity - 0.058);
      this.fpFlashMat.opacity = this.flashOpacity;
    }

    // ── Camera update (Dynamic Arcade Camera Solver) ──────────────────────────
    // Smoothly decay/damp FOV back to base FOV (impact zoom recovery)
    this.camCurrentFov = THREE.MathUtils.lerp(this.camCurrentFov, this.camBaseFov, Math.min(1, animDelta * 9.5));
    this.camera.fov = this.camCurrentFov;
    this.camera.updateProjectionMatrix();

    if (this.cameraMode === "third-person") {
      // Calculate target camera position (Base pos + subtle breathing sway)
      this.camTargetPos.set(
        TP_POS.x + Math.sin(t * 0.20) * 0.14,
        TP_POS.y + Math.sin(t * 0.33) * 0.09,
        TP_POS.z
      );

      // Dodge Screen Roll and Tilt Translation (rolls in direction of slip, translates opposite)
      if (this.playerDodgeType === "slip-left" || this.playerDodgeType === "dodge-left") {
        this.camTargetPos.x += 0.32;
        this.camTargetRoll = 0.045; // Roll camera right (+2.5 degrees)
      } else if (this.playerDodgeType === "slip-right" || this.playerDodgeType === "dodge-right") {
        this.camTargetPos.x -= 0.32;
        this.camTargetRoll = -0.045; // Roll camera left (-2.5 degrees)
      } else {
        this.camTargetRoll = 0;
      }

      // Add high-frequency camera shake offset
      if (this.cameraShake > 0) {
        const s = this.cameraShake;
        this.camTargetPos.x += (Math.random() - 0.5) * s * 0.33;
        this.camTargetPos.y += (Math.random() - 0.5) * s * 0.22;
        this.camTargetPos.z += (Math.random() - 0.5) * s * 0.10;
        this.cameraShake = Math.max(0, this.cameraShake - animDelta * 3.8); // Frame-rate independent decay
      }

      // Critically damped spring interpolation for smooth motion sickness suppression
      const lerpF = Math.min(1, animDelta * 9.2);
      this.camCurrentPos.lerp(this.camTargetPos, lerpF);
      this.camCurrentRoll = THREE.MathUtils.lerp(this.camCurrentRoll, this.camTargetRoll, lerpF);

      this.camera.position.copy(this.camCurrentPos);
      this.camera.lookAt(TP_LOOKAT);
      this.camera.rotation.z += this.camCurrentRoll; // Apply screen tilt

    } else if (this.cameraMode === "transitioning") {
      const elapsed = now - this.fpTransStart;
      const rawT    = Math.min(1, elapsed / this.FP_TRANS_MS);
      const easedT  = smootherstep(rawT);

      this.camera.position.lerpVectors(this.fpTransStartPos, FP_POS, easedT);
      this.camera.quaternion.slerpQuaternions(this.fpTransStartQuat, this.fpTargetQuat, easedT);

      // Synchronize internal controller starting positions
      this.camCurrentPos.copy(this.camera.position);
      this.camCurrentLookAt.copy(FP_LOOKAT);

      if (rawT >= 1) {
        this.cameraMode = "first-person";
        this.camera.position.copy(FP_POS);
        this.camera.quaternion.copy(this.fpTargetQuat);
        this.fpArms.group.visible  = true;
        this.player.group.visible  = false; // hide own body in FP
      }

    } else { // first-person
      this.camTargetPos.set(
        FP_POS.x + Math.sin(t * 0.38) * 0.022,
        FP_POS.y + Math.sin(t * 0.62) * 0.016,
        FP_POS.z
      );

      this.camTargetLookAt.set(
        FP_LOOKAT.x + Math.sin(t * 0.28) * 0.013,
        FP_LOOKAT.y + Math.sin(t * 0.45) * 0.009,
        FP_LOOKAT.z
      );

      // First-person dodge response
      if (this.playerDodgeType === "slip-left" || this.playerDodgeType === "dodge-left") {
        this.camTargetPos.x += 0.20;
        this.camTargetRoll = 0.038;
      } else if (this.playerDodgeType === "slip-right" || this.playerDodgeType === "dodge-right") {
        this.camTargetPos.x -= 0.20;
        this.camTargetRoll = -0.038;
      } else {
        this.camTargetRoll = 0;
      }

      // First-person camera shake
      if (this.cameraShake > 0) {
        const s = this.cameraShake * 0.55;
        this.camTargetPos.x += (Math.random() - 0.5) * s * 0.14;
        this.camTargetPos.y += (Math.random() - 0.5) * s * 0.11;
        this.camTargetPos.z += (Math.random() - 0.5) * s * 0.07;
        this.cameraShake = Math.max(0, this.cameraShake - animDelta * 3.8);
      }

      const lerpF = Math.min(1, animDelta * 9.2);
      this.camCurrentPos.lerp(this.camTargetPos, lerpF);
      this.camCurrentLookAt.lerp(this.camTargetLookAt, lerpF);
      this.camCurrentRoll = THREE.MathUtils.lerp(this.camCurrentRoll, this.camTargetRoll, lerpF);

      this.camera.position.copy(this.camCurrentPos);
      this.camera.lookAt(this.camCurrentLookAt);
      this.camera.rotation.z += this.camCurrentRoll;

      // Record previous positions to calculate speed
      this.prevLPos.copy(this.fpLCurrent);
      this.prevRPos.copy(this.fpRCurrent);

      // Smooth FP gloves toward their targets
      const gloveLerpF = Math.min(1, animDelta * 22);
      this.fpLCurrent.lerp(this.fpLTarget, gloveLerpF);
      this.fpRCurrent.lerp(this.fpRTarget, gloveLerpF);

      this.fpArms.leftGlove.position.copy(this.fpLCurrent);
      this.fpArms.rightGlove.position.copy(this.fpRCurrent);
      // Arm cylinders sit just behind each glove
      this.fpArms.leftArm.position.set(
        this.fpLCurrent.x, this.fpLCurrent.y + 0.06, this.fpLCurrent.z + 0.25,
      );
      this.fpArms.rightArm.position.set(
        this.fpRCurrent.x, this.fpRCurrent.y + 0.06, this.fpRCurrent.z + 0.25,
      );

      // Idle bob
      const bob = Math.sin(t * 1.55) * 0.011;
      this.fpArms.leftGlove.position.y  += bob;
      this.fpArms.rightGlove.position.y += bob;

      // Calculate hand speeds (meters per second)
      const speedL = this.fpLCurrent.distanceTo(this.prevLPos) / (realDelta || 0.016);
      const speedR = this.fpRCurrent.distanceTo(this.prevRPos) / (realDelta || 0.016);

      // Scale trail opacity based on speed (speed > 0.28 fades trails in, stationary fades trails out to 0)
      const targetOpacityL = speedL > 0.28 ? Math.min(0.6, (speedL - 0.28) * 0.25) : 0;
      const targetOpacityR = speedR > 0.28 ? Math.min(0.6, (speedR - 0.28) * 0.25) : 0;

      this.leftTrailOpacity = THREE.MathUtils.lerp(this.leftTrailOpacity, targetOpacityL, Math.min(1, animDelta * 10));
      this.rightTrailOpacity = THREE.MathUtils.lerp(this.rightTrailOpacity, targetOpacityR, Math.min(1, animDelta * 10));

      // Update left echoes
      if (this.leftEchoes.length > 0) {
        this.leftEchoes[0].position.copy(this.fpArms.leftGlove.position);
        this.leftEchoes[0].rotation.copy(this.fpArms.leftGlove.rotation);
        for (let i = 1; i < this.leftEchoes.length; i++) {
          this.leftEchoes[i].position.lerp(this.leftEchoes[i - 1].position, 0.35);
          this.leftEchoes[i].rotation.copy(this.leftEchoes[i - 1].rotation);
        }
        for (let i = 0; i < this.leftEchoes.length; i++) {
          const mat = this.leftEchoes[i].material as THREE.MeshBasicMaterial;
          const factor = 1 - (i / this.leftEchoes.length);
          mat.opacity = this.leftTrailOpacity * factor;
          this.leftEchoes[i].visible = mat.opacity > 0.01;
        }
      }

      // Update right echoes
      if (this.rightEchoes.length > 0) {
        this.rightEchoes[0].position.copy(this.fpArms.rightGlove.position);
        this.rightEchoes[0].rotation.copy(this.fpArms.rightGlove.rotation);
        for (let i = 1; i < this.rightEchoes.length; i++) {
          this.rightEchoes[i].position.lerp(this.rightEchoes[i - 1].position, 0.35);
          this.rightEchoes[i].rotation.copy(this.rightEchoes[i - 1].rotation);
        }
        for (let i = 0; i < this.rightEchoes.length; i++) {
          const mat = this.rightEchoes[i].material as THREE.MeshBasicMaterial;
          const factor = 1 - (i / this.rightEchoes.length);
          mat.opacity = this.rightTrailOpacity * factor;
          this.rightEchoes[i].visible = mat.opacity > 0.01;
        }
      }
    }

    // Decay hits
    if (this.playerHit > 0) this.playerHit = Math.max(0, this.playerHit - 0.068);
    if (this.aiHit     > 0) this.aiHit     = Math.max(0, this.aiHit     - 0.068);

    this.playerPunch = this.animateFighter(this.player, t, this.playerPunch, this.playerHit, this.playerKO, false, this.playerBlock);
    this.aiPunch     = this.animateFighter(this.ai,     t, this.aiPunch,     this.aiHit,     this.aiKO,     true,  false);
    const refArmsUp = this.refereeSignal === "fight" ? 1.35 : this.refereeSignal === "counting" ? 0.85 : 0.35;
    this.referee.leftArm.rotation.x = THREE.MathUtils.lerp(this.referee.leftArm.rotation.x, refArmsUp, 0.11);
    this.referee.rightArm.rotation.x = THREE.MathUtils.lerp(this.referee.rightArm.rotation.x, refArmsUp, 0.11);
    this.referee.leftArm.rotation.z = THREE.MathUtils.lerp(this.referee.leftArm.rotation.z, -0.35, 0.11);
    this.referee.rightArm.rotation.z = THREE.MathUtils.lerp(this.referee.rightArm.rotation.z, 0.35, 0.11);
    const refWave = this.refereeSignal === "fight" ? 1.25 : this.refereeSignal === "counting" ? 0.65 : 0.15;
    this.player.group.rotation.y = Math.PI + Math.sin(t * 0.7) * 0.008;
    this.ai.group.rotation.y = Math.sin(t * 0.7) * -0.008;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.refereeSignal === "counting" ? 60 : 58, 0.08);
    this.camera.updateProjectionMatrix();
    this.scene.rotation.y = THREE.MathUtils.lerp(this.scene.rotation.y, Math.sin(t * 0.3) * 0.01 * refWave, 0.06);

    // GPU Instanced Spark Particles kinematic update
    {
      const now = performance.now();
      const tempMatrix = new THREE.Matrix4();
      const tempPos = new THREE.Vector3();
      let needsUpdate = false;

      for (let i = 0; i < this.MAX_SPARKS; i++) {
        const data = this.sparkData[i];
        if (!data.active) continue;

        const age = now - data.birth;
        if (age >= data.life) {
          data.active = false;
          tempMatrix.makeTranslation(9999, 9999, 9999);
          this.sparkParticles.setMatrixAt(i, tempMatrix);
          needsUpdate = true;
          continue;
        }

        const tSecs = age / 1000;
        tempPos.copy(data.pos).addScaledVector(data.vel, tSecs);
        tempPos.y -= 0.5 * 9.8 * tSecs * tSecs; // Gravity pull

        const scale = Math.max(0, 1 - age / data.life) * 0.95;
        tempMatrix.makeScale(scale, scale, scale);
        tempMatrix.setPosition(tempPos);

        this.sparkParticles.setMatrixAt(i, tempMatrix);
        needsUpdate = true;
      }

      if (needsUpdate) {
        this.sparkParticles.instanceMatrix.needsUpdate = true;
      }
    }

    this.updateHitEffects();
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
