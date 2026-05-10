import * as THREE from "three";

interface FighterMeshes {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftGlove: THREE.Mesh;
  rightGlove: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
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

  // Animation state
  private playerPunchState: { hand: "left" | "right"; t: number } | null = null;
  private aiPunchState: { hand: "left" | "right"; t: number } | null = null;
  private playerHitState = 0;
  private aiHitState = 0;
  private playerKO = false;
  private aiKO = false;

  /** Returns true on success, false if WebGL is unavailable */
  tryInit(canvas: HTMLCanvasElement): boolean {
    try {
      this.init(canvas);
      return true;
    } catch {
      return false;
    }
  }

  init(canvas: HTMLCanvasElement): void {
    // Renderer — may throw if WebGL context cannot be created
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, failIfMajorPerformanceCaveat: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a14);
    this.scene.fog = new THREE.Fog(0x0a0a14, 15, 35);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      55,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1.2, 0);

    this.buildArena();
    this.buildLights();
    this.player = this.buildFighter(false);
    this.ai = this.buildFighter(true);
    this.player.group.position.set(-2.2, 0, 0);
    this.ai.group.position.set(2.2, 0, 0);
    // AI faces left
    this.ai.group.rotation.y = Math.PI;
  }

  private buildArena(): void {
    // Ring canvas floor
    const floorGeo = new THREE.BoxGeometry(10, 0.15, 8);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0xe8d5b0 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Ring lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xcc3333 });
    const addLine = (x: number, y: number, z: number, w: number, d: number) => {
      const geo = new THREE.BoxGeometry(w, 0.02, d);
      const m = new THREE.Mesh(geo, lineMat);
      m.position.set(x, y, z);
      this.scene.add(m);
    };
    addLine(0, 0.001, 0, 0.08, 7.5); // center line
    addLine(0, 0.001, 0, 9.5, 0.08); // horizontal center

    // Corner posts
    const postMat = new THREE.MeshPhongMaterial({ color: 0x333344 });
    const postPositions = [[-5, 4], [5, 4], [-5, -4], [5, -4]] as [number, number][];
    postPositions.forEach(([px, pz]) => {
      const geo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8);
      const post = new THREE.Mesh(geo, postMat);
      post.position.set(px, 1.6, pz);
      post.castShadow = true;
      this.scene.add(post);
    });

    // Ropes
    const ropeColors = [0xff2222, 0xffffff, 0xff2222];
    const ropeHeights = [0.8, 1.6, 2.4];
    ropeColors.forEach((color, i) => {
      const ropeMat = new THREE.MeshPhongMaterial({ color });
      const h = ropeHeights[i];
      // Front and back ropes
      [[4], [-4]].forEach(([pz]) => {
        const geo = new THREE.CylinderGeometry(0.04, 0.04, 10.1, 6);
        geo.rotateZ(Math.PI / 2);
        const rope = new THREE.Mesh(geo, ropeMat);
        rope.position.set(0, h, pz);
        this.scene.add(rope);
      });
      // Side ropes
      [[-5], [5]].forEach(([px]) => {
        const geo = new THREE.CylinderGeometry(0.04, 0.04, 8.1, 6);
        geo.rotateX(Math.PI / 2);
        const rope = new THREE.Mesh(geo, ropeMat);
        rope.position.set(px, h, 0);
        this.scene.add(rope);
      });
    });

    // Crowd backdrop
    const backdropGeo = new THREE.PlaneGeometry(30, 8);
    const backdropMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a2e,
      side: THREE.DoubleSide,
    });
    const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
    backdrop.position.set(0, 3, -8);
    this.scene.add(backdrop);

    // Crowd lights (scattered points)
    for (let i = 0; i < 30; i++) {
      const geo = new THREE.SphereGeometry(0.08, 4, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.8, 0.7),
      });
      const dot = new THREE.Mesh(geo, mat);
      dot.position.set(
        (Math.random() - 0.5) * 28,
        Math.random() * 5 + 0.5,
        -7.5
      );
      this.scene.add(dot);
    }
  }

  private buildLights(): void {
    const ambient = new THREE.AmbientLight(0x333355, 1.5);
    this.scene.add(ambient);

    // Main spotlight
    const spot = new THREE.SpotLight(0xfff0dd, 3, 20, Math.PI / 5, 0.4);
    spot.position.set(0, 10, 2);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);
    this.scene.add(spot.target);

    // Player side blue light
    const blueLight = new THREE.PointLight(0x4466ff, 2, 8);
    blueLight.position.set(-3, 3, 2);
    this.scene.add(blueLight);

    // AI side red light
    const redLight = new THREE.PointLight(0xff4422, 2, 8);
    redLight.position.set(3, 3, 2);
    this.scene.add(redLight);
  }

  private buildFighter(isAI: boolean): FighterMeshes {
    const group = new THREE.Group();

    const trunkColor = isAI ? 0xaa0000 : 0x0044cc;
    const skinColor = 0xd4956a;
    const gloveColor = isAI ? 0xcc1111 : 0x1155ee;
    const shoeColor = 0x111111;

    const skinMat = new THREE.MeshPhongMaterial({ color: skinColor, shininess: 60 });
    const trunkMat = new THREE.MeshPhongMaterial({ color: trunkColor, shininess: 80 });
    const gloveMat = new THREE.MeshPhongMaterial({ color: gloveColor, shininess: 120 });
    const shoeMat = new THREE.MeshPhongMaterial({ color: shoeColor });
    const shirtMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee });

    // Torso
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.8, 0.4),
      [trunkMat, trunkMat, shirtMat, trunkMat, shirtMat, shirtMat]
    );
    torso.position.y = 0.8;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      skinMat
    );
    head.position.y = 1.55;
    head.castShadow = true;
    group.add(head);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8),
      skinMat
    );
    neck.position.y = 1.27;
    group.add(neck);

    // Helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshPhongMaterial({ color: trunkColor, opacity: 0.85, transparent: true, shininess: 120 })
    );
    helmet.position.y = 1.58;
    helmet.scale.y = 0.95;
    group.add(helmet);

    // Arms
    const makeArm = (side: number): THREE.Group => {
      const armGroup = new THREE.Group();
      armGroup.position.set(side * 0.42, 0.9, 0);

      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.09, 0.5, 8),
        skinMat
      );
      upper.rotation.z = -side * 0.3;
      upper.position.set(side * 0.08, 0, 0);
      upper.castShadow = true;
      armGroup.add(upper);

      const forearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.07, 0.45, 8),
        skinMat
      );
      forearm.position.set(side * 0.15, -0.4, 0.15);
      forearm.rotation.x = 0.4;
      forearm.castShadow = true;
      armGroup.add(forearm);

      const glove = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 10, 10),
        gloveMat
      );
      glove.scale.set(1, 0.85, 1.2);
      glove.position.set(side * 0.15, -0.65, 0.35);
      glove.castShadow = true;
      armGroup.add(glove);

      return armGroup;
    };

    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);
    group.add(leftArm, rightArm);

    // Get glove references
    const leftGlove = leftArm.children[2] as THREE.Mesh;
    const rightGlove = rightArm.children[2] as THREE.Mesh;

    // Hips/shorts
    const hips = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.45, 0.38),
      trunkMat
    );
    hips.position.y = 0.32;
    hips.castShadow = true;
    group.add(hips);

    // Legs
    const makeLeg = (side: number): THREE.Mesh => {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.09, 0.6, 8),
        skinMat
      );
      leg.position.set(side * 0.18, -0.07, 0);
      leg.castShadow = true;
      group.add(leg);
      return leg;
    };
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    // Shoes
    const makeShoe = (side: number) => {
      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.12, 0.35),
        shoeMat
      );
      shoe.position.set(side * 0.18, -0.38, 0.06);
      group.add(shoe);
    };
    makeShoe(-1);
    makeShoe(1);

    this.scene.add(group);
    return { group, torso, head, leftArm, rightArm, leftGlove, rightGlove, leftLeg, rightLeg };
  }

  // Trigger player punch animation
  triggerPlayerPunch(hand: "left" | "right"): void {
    this.playerPunchState = { hand, t: 0 };
  }

  triggerAIPunch(hand: "left" | "right"): void {
    this.aiPunchState = { hand, t: 0 };
  }

  triggerPlayerHit(): void {
    this.playerHitState = 1;
    this.spawnHitEffect(this.player.group.position.clone().setY(1.5));
  }

  triggerAIHit(): void {
    this.aiHitState = 1;
    this.spawnHitEffect(this.ai.group.position.clone().setY(1.5));
  }

  setPlayerKO(v: boolean): void {
    this.playerKO = v;
  }

  setAIKO(v: boolean): void {
    this.aiKO = v;
  }

  private spawnHitEffect(pos: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaa22,
      transparent: true,
      opacity: 0.9,
      wireframe: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.hitEffects.push({ mesh, born: performance.now(), duration: 300 });
  }

  private updateHitEffects(): void {
    const now = performance.now();
    this.hitEffects = this.hitEffects.filter(({ mesh, born, duration }) => {
      const t = (now - born) / duration;
      if (t >= 1) {
        this.scene.remove(mesh);
        return false;
      }
      mesh.scale.setScalar(1 + t * 2);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      return true;
    });
  }

  private animateFighter(
    fighter: FighterMeshes,
    t: number,
    punchState: { hand: "left" | "right"; t: number } | null,
    hitState: number,
    isKO: boolean,
    isAI: boolean
  ): { hand: "left" | "right"; t: number } | null {
    const { leftArm, rightArm, torso, head, group } = fighter;

    // KO animation
    if (isKO) {
      group.rotation.z = isAI ? -1.4 : 1.4;
      group.position.y = -0.3;
      return null;
    }

    // Reset KO
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, 0, 0.1);
    group.position.y = THREE.MathUtils.lerp(group.position.y, 0, 0.1);

    // Idle breathing
    torso.scale.y = 1 + Math.sin(t * 1.5) * 0.02;
    head.position.y = 1.55 + Math.sin(t * 1.5) * 0.008;

    // Idle guard position
    leftArm.rotation.x = THREE.MathUtils.lerp(leftArm.rotation.x, 0.3, 0.08);
    rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, 0.3, 0.08);
    leftArm.rotation.z = THREE.MathUtils.lerp(leftArm.rotation.z, 0, 0.08);
    rightArm.rotation.z = THREE.MathUtils.lerp(rightArm.rotation.z, 0, 0.08);

    // Hit state
    if (hitState > 0) {
      const hitT = hitState;
      head.position.x = (isAI ? -1 : 1) * Math.sin(hitT * Math.PI) * 0.15;
      group.position.z = -Math.sin(hitT * Math.PI) * 0.2;
    }

    // Punch animation
    if (punchState) {
      punchState.t = Math.min(1, punchState.t + 0.12);
      const arm = punchState.hand === "left" ? leftArm : rightArm;
      const pt = punchState.t;
      const punchProgress = pt < 0.5 ? pt * 2 : (1 - pt) * 2;
      arm.rotation.x = 0.3 + punchProgress * 1.2;
      arm.rotation.z = punchProgress * (punchState.hand === "left" ? -0.4 : 0.4);
      if (punchState.t >= 1) return null;
    }

    return punchState;
  }

  startRendering(): void {
    if (this.running) return;
    this.running = true;
    this.renderLoop();
  }

  stopRendering(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  private renderLoop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.renderLoop);

    const t = this.clock.getElapsedTime();

    // Decay hit states
    if (this.playerHitState > 0) this.playerHitState = Math.max(0, this.playerHitState - 0.08);
    if (this.aiHitState > 0) this.aiHitState = Math.max(0, this.aiHitState - 0.08);

    this.playerPunchState = this.animateFighter(
      this.player, t, this.playerPunchState, this.playerHitState, this.playerKO, false
    );
    this.aiPunchState = this.animateFighter(
      this.ai, t, this.aiPunchState, this.aiHitState, this.aiKO, true
    );

    this.updateHitEffects();
    this.renderer.render(this.scene, this.camera);
  };

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.stopRendering();
    this.renderer.dispose();
  }
}
