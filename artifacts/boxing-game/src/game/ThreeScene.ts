import * as THREE from "three";

interface FighterMeshes {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftGlove: THREE.Mesh;
  rightGlove: THREE.Mesh;
}

interface HitEffect {
  mesh: THREE.Mesh;
  born: number;
  duration: number;
}

export class ThreeScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private player!: FighterMeshes;
  private ai!: FighterMeshes;
  private animFrameId = 0;
  private clock = new THREE.Clock();
  private hitEffects: HitEffect[] = [];
  private running = false;

  // Camera shake
  private cameraShake = 0;
  private cameraBasePos = new THREE.Vector3(0, 4.5, 10.5);

  // Fighter animation state
  private playerPunch: { hand: "left" | "right"; t: number } | null = null;
  private aiPunch: { hand: "left" | "right"; t: number } | null = null;
  private playerHit = 0;   // 0–1 decay
  private aiHit = 0;
  private playerKO = false;
  private aiKO = false;
  private playerBlock = false;

  // ── Public API ────────────────────────────────────────────────────────────
  tryInit(canvas: HTMLCanvasElement): boolean {
    try { this.init(canvas); return true; } catch { return false; }
  }

  init(canvas: HTMLCanvasElement): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08080f);
    this.scene.fog = new THREE.Fog(0x08080f, 18, 38);

    this.camera = new THREE.PerspectiveCamera(
      52,
      (canvas.clientWidth || 800) / (canvas.clientHeight || 600),
      0.1,
      100
    );
    this.camera.position.copy(this.cameraBasePos);
    this.camera.lookAt(0, 1.4, 0);

    this.buildArena();
    this.buildLights();
    this.player = this.buildFighter(false);
    this.ai     = this.buildFighter(true);
    this.player.group.position.set(-2.5, 0, 0);
    this.ai.group.position.set(2.5, 0, 0);
    this.ai.group.rotation.y = Math.PI;
  }

  triggerPlayerPunch(hand: "left" | "right"): void { this.playerPunch = { hand, t: 0 }; }
  triggerAIPunch(hand: "left" | "right"): void { this.aiPunch = { hand, t: 0 }; }
  triggerPlayerHit(): void { this.playerHit = 1; this.spawnHit(this.player.group.position.clone().setY(1.6)); this.cameraShake = Math.max(this.cameraShake, 0.9); }
  triggerAIHit(): void { this.aiHit = 1; this.spawnHit(this.ai.group.position.clone().setY(1.6)); }
  setPlayerKO(v: boolean): void { this.playerKO = v; }
  setAIKO(v: boolean): void { this.aiKO = v; }
  setPlayerBlocking(v: boolean): void { this.playerBlock = v; }

  startRendering(): void {
    if (this.running) return;
    this.running = true;
    this.renderLoop();
  }

  stopRendering(): void { this.running = false; cancelAnimationFrame(this.animFrameId); }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void { this.stopRendering(); this.renderer.dispose(); }

  // ── Arena ─────────────────────────────────────────────────────────────────
  private buildArena(): void {
    // Canvas floor
    const floorMat = new THREE.MeshPhongMaterial({ color: 0xdcc88a, shininess: 20 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.15, 9), floorMat);
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Red centre line
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xcc2222 });
    const vLine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 8.6), lineMat);
    vLine.position.y = 0.001;
    this.scene.add(vLine);

    // Corner posts
    const postMat = new THREE.MeshPhongMaterial({ color: 0x222233 });
    [[-5.5, -4.5], [5.5, -4.5], [-5.5, 4.5], [5.5, 4.5]].forEach(([px, pz]) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.5, 8), postMat);
      post.position.set(px, 1.75, pz);
      post.castShadow = true;
      this.scene.add(post);
    });

    // Ropes (3 per side)
    [0.7, 1.5, 2.3].forEach((h) => {
      const clr = h === 1.5 ? 0xffffff : 0xdd1111;
      const ropeMat = new THREE.MeshPhongMaterial({ color: clr });
      // Front / back (along x)
      [4.5, -4.5].forEach((pz) => {
        const geo = new THREE.CylinderGeometry(0.04, 0.04, 11.1, 6);
        geo.rotateZ(Math.PI / 2);
        const r = new THREE.Mesh(geo, ropeMat);
        r.position.set(0, h, pz);
        this.scene.add(r);
      });
      // Sides (along z)
      [-5.5, 5.5].forEach((px) => {
        const geo = new THREE.CylinderGeometry(0.04, 0.04, 9.1, 6);
        geo.rotateX(Math.PI / 2);
        const r = new THREE.Mesh(geo, ropeMat);
        r.position.set(px, h, 0);
        this.scene.add(r);
      });
    });

    // Crowd backdrop + scattered lights
    const bd = new THREE.Mesh(
      new THREE.PlaneGeometry(35, 10),
      new THREE.MeshBasicMaterial({ color: 0x12122a, side: THREE.DoubleSide })
    );
    bd.position.set(0, 3, -9);
    this.scene.add(bd);
    for (let i = 0; i < 50; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 4, 4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.7) })
      );
      dot.position.set((Math.random() - 0.5) * 32, Math.random() * 7, -8.5);
      this.scene.add(dot);
    }
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x334466, 2));

    const spot = new THREE.SpotLight(0xfff0cc, 4, 22, Math.PI / 5, 0.35);
    spot.position.set(0, 11, 3);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);

    const bl = new THREE.PointLight(0x4466ff, 2.5, 9);
    bl.position.set(-3.5, 3.5, 2);
    this.scene.add(bl);

    const rl = new THREE.PointLight(0xff4422, 2.5, 9);
    rl.position.set(3.5, 3.5, 2);
    this.scene.add(rl);
  }

  // ── Fighter builder ───────────────────────────────────────────────────────
  private buildFighter(isAI: boolean): FighterMeshes {
    const g = new THREE.Group();
    const trunk   = isAI ? 0xaa0000 : 0x0044cc;
    const gloveC  = isAI ? 0xcc1111 : 0x1155ee;
    const skin    = 0xc8855a;

    const skinM  = new THREE.MeshPhongMaterial({ color: skin, shininess: 60 });
    const trunkM = new THREE.MeshPhongMaterial({ color: trunk, shininess: 80 });
    const gloveM = new THREE.MeshPhongMaterial({ color: gloveC, shininess: 140 });
    const shoeM  = new THREE.MeshPhongMaterial({ color: 0x0a0a0a });

    // ── Torso ──
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.85, 0.42),
      [trunkM, trunkM, new THREE.MeshPhongMaterial({ color: 0xffffff }), trunkM, trunkM, trunkM]
    );
    torso.position.y = 0.85;
    torso.castShadow = true;
    g.add(torso);

    // ── Neck ──
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.2, 8), skinM);
    neck.position.y = 1.3;
    g.add(neck);

    // ── Head ──
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 14), skinM);
    head.position.y = 1.6;
    head.castShadow = true;
    g.add(head);

    // ── Helmet ──
    const helmetM = new THREE.MeshPhongMaterial({ color: trunk, shininess: 130, opacity: 0.88, transparent: true });
    const helmet  = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 14), helmetM);
    helmet.position.y = 1.63;
    helmet.scale.y = 0.94;
    g.add(helmet);

    // ── Arms & gloves ──
    const makeArm = (side: number): THREE.Group => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.44, 0.95, 0);

      // Upper arm
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.52, 8), skinM);
      upper.rotation.z = -side * 0.28;
      upper.castShadow = true;
      arm.add(upper);

      // Forearm
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.46, 8), skinM);
      fore.position.set(side * 0.12, -0.42, 0.18);
      fore.rotation.x = 0.38;
      fore.castShadow = true;
      arm.add(fore);

      // Glove
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 12), gloveM);
      glove.scale.set(1, 0.82, 1.25);
      glove.position.set(side * 0.13, -0.68, 0.4);
      glove.castShadow = true;
      arm.add(glove);

      return arm;
    };

    const leftArm  = makeArm(-1);
    const rightArm = makeArm(1);
    g.add(leftArm, rightArm);
    const leftGlove  = leftArm.children[2] as THREE.Mesh;
    const rightGlove = rightArm.children[2] as THREE.Mesh;

    // ── Hips ──
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.46, 0.4), trunkM);
    hips.position.y = 0.32;
    hips.castShadow = true;
    g.add(hips);

    // ── Legs ──
    const makeLeg = (side: number) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.62, 8), skinM);
      leg.position.set(side * 0.19, -0.05, 0);
      leg.castShadow = true;
      g.add(leg);
    };
    makeLeg(-1);
    makeLeg(1);

    // ── Shoes ──
    const makeShoe = (side: number) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.38), shoeM);
      s.position.set(side * 0.19, -0.38, 0.08);
      g.add(s);
    };
    makeShoe(-1);
    makeShoe(1);

    this.scene.add(g);
    return { group: g, torso, head, leftArm, rightArm, leftGlove, rightGlove };
  }

  // ── Hit spark ─────────────────────────────────────────────────────────────
  private spawnHit(pos: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.45, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.9, wireframe: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.hitEffects.push({ mesh, born: performance.now(), duration: 320 });
  }

  private updateHitEffects(): void {
    const now = performance.now();
    this.hitEffects = this.hitEffects.filter(({ mesh, born, duration }) => {
      const t = (now - born) / duration;
      if (t >= 1) { this.scene.remove(mesh); return false; }
      mesh.scale.setScalar(1 + t * 2.5);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      return true;
    });
  }

  // ── Animate a fighter ─────────────────────────────────────────────────────
  private animateFighter(
    f: FighterMeshes,
    t: number,
    punch: { hand: "left" | "right"; t: number } | null,
    hit: number,
    isKO: boolean,
    isAI: boolean,
    blocking: boolean
  ): { hand: "left" | "right"; t: number } | null {
    const { group, torso, head, leftArm, rightArm } = f;

    // KO fall
    if (isKO) {
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, isAI ? -1.45 : 1.45, 0.07);
      group.position.y = THREE.MathUtils.lerp(group.position.y, -0.35, 0.07);
      return null;
    }
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, 0, 0.12);
    group.position.y = THREE.MathUtils.lerp(group.position.y, 0, 0.12);

    // Idle breathe
    torso.scale.y = 1 + Math.sin(t * 1.4) * 0.025;
    head.position.y = 1.6 + Math.sin(t * 1.4) * 0.01;

    // Guard position (arms slightly raised forward)
    const guardX = blocking ? 0.7 : 0.3;
    const blockY = blocking ? -0.2 : 0;
    leftArm.rotation.x  = THREE.MathUtils.lerp(leftArm.rotation.x,  guardX, 0.1);
    rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, guardX, 0.1);
    leftArm.position.z  = THREE.MathUtils.lerp(leftArm.position.z,  blocking ? 0.3 : 0, 0.1);
    rightArm.position.z = THREE.MathUtils.lerp(rightArm.position.z, blocking ? 0.3 : 0, 0.1);
    leftArm.position.y  = THREE.MathUtils.lerp(leftArm.position.y,  blockY, 0.1);
    rightArm.position.y = THREE.MathUtils.lerp(rightArm.position.y, blockY, 0.1);

    // Hit stagger
    if (hit > 0.1) {
      head.position.x = (isAI ? -1 : 1) * Math.sin(hit * Math.PI) * 0.18;
      group.position.z = -Math.sin(hit * Math.PI) * 0.25;
    } else {
      head.position.x = THREE.MathUtils.lerp(head.position.x, 0, 0.2);
      group.position.z = THREE.MathUtils.lerp(group.position.z, 0, 0.2);
    }

    // Punch animation — dramatic extension
    if (punch) {
      punch.t = Math.min(1, punch.t + 0.14);
      const arm = punch.hand === "left" ? leftArm : rightArm;
      const ext = Math.sin(punch.t * Math.PI); // 0→1→0
      const side = punch.hand === "left" ? -1 : 1;
      arm.rotation.x = guardX + ext * 1.5;
      arm.rotation.z = ext * side * 0.5;
      arm.position.z = ext * 0.5;
      if (punch.t >= 1) return null;
    }

    return punch;
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  private renderLoop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.renderLoop);
    const t = this.clock.getElapsedTime();

    // Camera shake decay
    if (this.cameraShake > 0) {
      const s = this.cameraShake;
      this.camera.position.set(
        this.cameraBasePos.x + (Math.random() - 0.5) * s * 0.35,
        this.cameraBasePos.y + (Math.random() - 0.5) * s * 0.2,
        this.cameraBasePos.z + (Math.random() - 0.5) * s * 0.1,
      );
      this.cameraShake = Math.max(0, this.cameraShake - 0.08);
    } else {
      // Subtle dynamic camera breathing
      this.camera.position.set(
        this.cameraBasePos.x + Math.sin(t * 0.22) * 0.12,
        this.cameraBasePos.y + Math.sin(t * 0.35) * 0.08,
        this.cameraBasePos.z,
      );
    }
    this.camera.lookAt(0, 1.4, 0);

    // Decay hit states
    if (this.playerHit > 0) this.playerHit = Math.max(0, this.playerHit - 0.07);
    if (this.aiHit > 0)     this.aiHit     = Math.max(0, this.aiHit - 0.07);

    this.playerPunch = this.animateFighter(this.player, t, this.playerPunch, this.playerHit, this.playerKO, false, this.playerBlock);
    this.aiPunch     = this.animateFighter(this.ai,     t, this.aiPunch,     this.aiHit,     this.aiKO,     true,  false);

    this.updateHitEffects();
    this.renderer.render(this.scene, this.camera);
  };
}
