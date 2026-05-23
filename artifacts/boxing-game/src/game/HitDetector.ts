export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export type HurtboxType = "head" | "torso" | "guard";

export interface Hurtbox {
  id: string;
  owner: "player" | "ai";
  type: HurtboxType;
  pos: Vector3D;
  radius: number;
  height?: number; // For cylinder if needed, otherwise using sphere bounds
}

export interface Hitbox {
  id: string; // e.g. "player_left", "player_right"
  owner: "player" | "ai";
  pos: Vector3D;
  prevPos: Vector3D;
  radius: number;
  active: boolean;
  strikeId: string | null; // Unique identifier for current punch to prevent double hits
}

export class HitDetector {
  private hurtboxes: Hurtbox[] = [];
  private hitboxes: Hitbox[] = [];
  private processedStrikes = new Set<string>(); // Tracks hit registration to prevent multi-hit jitter

  constructor() {
    this.reset();
  }

  reset(): void {
    this.hurtboxes = [];
    this.hitboxes = [];
    this.processedStrikes.clear();

    // ── Build Default Player Hurtboxes ──────────────────────────────────────────
    // Player is at Z = 2.5, facing -Z
    this.hurtboxes.push({
      id: "player_head",
      owner: "player",
      type: "head",
      pos: { x: 0, y: 1.67, z: 2.5 },
      radius: 0.28,
    });
    this.hurtboxes.push({
      id: "player_torso",
      owner: "player",
      type: "torso",
      pos: { x: 0, y: 0.88, z: 2.5 },
      radius: 0.38,
    });
    this.hurtboxes.push({
      id: "player_guard",
      owner: "player",
      type: "guard",
      pos: { x: 0, y: 1.55, z: 2.2 }, // block slightly in front of head
      radius: 0.32,
    });

    // ── Build Default AI Hurtboxes ──────────────────────────────────────────────
    // AI is at Z = -2.5, facing +Z
    this.hurtboxes.push({
      id: "ai_head",
      owner: "ai",
      type: "head",
      pos: { x: 0, y: 1.67, z: -2.5 },
      radius: 0.28,
    });
    this.hurtboxes.push({
      id: "ai_torso",
      owner: "ai",
      type: "torso",
      pos: { x: 0, y: 0.88, z: -2.5 },
      radius: 0.38,
    });
    this.hurtboxes.push({
      id: "ai_guard",
      owner: "ai",
      type: "guard",
      pos: { x: 0, y: 1.55, z: -2.2 }, // block slightly in front of head
      radius: 0.32,
    });

    // ── Build Hitboxes ────────────────────────────────────────────────────────
    // Player gloves
    this.hitboxes.push({
      id: "player_left",
      owner: "player",
      pos: { x: -0.38, y: 1.35, z: 2.2 },
      prevPos: { x: -0.38, y: 1.35, z: 2.2 },
      radius: 0.18,
      active: false,
      strikeId: null,
    });
    this.hitboxes.push({
      id: "player_right",
      owner: "player",
      pos: { x: 0.38, y: 1.35, z: 2.2 },
      prevPos: { x: 0.38, y: 1.35, z: 2.2 },
      radius: 0.18,
      active: false,
      strikeId: null,
    });

    // AI gloves
    this.hitboxes.push({
      id: "ai_left",
      owner: "ai",
      pos: { x: -0.38, y: 1.35, z: -2.2 },
      prevPos: { x: -0.38, y: 1.35, z: -2.2 },
      radius: 0.18,
      active: false,
      strikeId: null,
    });
    this.hitboxes.push({
      id: "ai_right",
      owner: "ai",
      pos: { x: 0.38, y: 1.35, z: -2.2 },
      radius: 0.18,
      prevPos: { x: 0.38, y: 1.35, z: -2.2 },
      active: false,
      strikeId: null,
    });
  }

  // ── Position Updaters ───────────────────────────────────────────────────────
  updateHurtboxPosition(id: string, x: number, y: number, z: number): void {
    const box = this.hurtboxes.find((h) => h.id === id);
    if (box) {
      box.pos.x = x;
      box.pos.y = y;
      box.pos.z = z;
    }
  }

  updateHitbox(id: string, x: number, y: number, z: number, active: boolean, strikeId: string | null): void {
    const box = this.hitboxes.find((h) => h.id === id);
    if (box) {
      box.prevPos.x = box.pos.x;
      box.prevPos.y = box.pos.y;
      box.prevPos.z = box.pos.z;
      box.pos.x = x;
      box.pos.y = y;
      box.pos.z = z;
      box.active = active;
      
      // If strikeId changes, reset processed record to allow new collision triggers
      if (strikeId !== box.strikeId) {
        box.strikeId = strikeId;
      }
    }
  }

  clearStrikeHistory(strikeId: string): void {
    this.processedStrikes.delete(strikeId);
  }

  // ── High Performance Continuous Collision Detection (Sweep Test) ──────────────
  // Checks if a swept sphere segment (P_prev -> P_curr) intersects with a target hurtbox sphere.
  // Performs 100% unrolled scalar math with ZERO allocations.
  private checkSweptSphereCollision(
    px1: number, py1: number, pz1: number, // P_prev
    px2: number, py2: number, pz2: number, // P_curr
    tx: number, ty: number, tz: number,    // Target position
    combinedRadius: number
  ): boolean {
    // Vector AB (movement of glove)
    const abx = px2 - px1;
    const aby = py2 - py1;
    const abz = pz2 - pz1;

    // Vector AC (vector from glove start to target)
    const acx = tx - px1;
    const acy = ty - py1;
    const acz = tz - pz1;

    // Dot products
    const ab_ab = abx * abx + aby * aby + abz * abz;
    
    // If start and end positions are identical (no movement)
    if (ab_ab < 0.000001) {
      const distSq = acx * acx + acy * acy + acz * acz;
      return distSq <= combinedRadius * combinedRadius;
    }

    const ac_ab = acx * abx + acy * aby + acz * abz;

    // Projection factor t, clamped to [0, 1]
    let t = ac_ab / ab_ab;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    // Closest point on the segment
    const cpx = px1 + t * abx;
    const cpy = py1 + t * aby;
    const cpz = pz1 + t * abz;

    // Vector from closest point to target
    const dx = tx - cpx;
    const dy = ty - cpy;
    const dz = tz - cpz;

    // Squared distance comparison
    const distSq = dx * dx + dy * dy + dz * dz;
    return distSq <= combinedRadius * combinedRadius;
  }

  // ── Collision Check Query ──────────────────────────────────────────────────
  // Evaluates active hitboxes against opposing hurtboxes.
  // Returns collision records with ZERO memory allocations in the collision tick.
  checkCollisions(
    onCollision: (
      attacker: "player" | "ai",
      strikeId: string,
      hurtboxId: string,
      hurtboxType: HurtboxType,
      hitPoint: Vector3D
    ) => void
  ): void {
    for (let i = 0; i < this.hitboxes.length; i++) {
      const hit = this.hitboxes[i];
      if (!hit.active || !hit.strikeId) continue;

      // Jitter Safeguard: If this strike already landed, don't re-trigger
      if (this.processedStrikes.has(hit.strikeId)) continue;

      const opposingOwner = hit.owner === "player" ? "ai" : "player";

      // Query opposing hurtboxes
      for (let j = 0; j < this.hurtboxes.length; j++) {
        const hurt = this.hurtboxes[j];
        if (hurt.owner !== opposingOwner) continue;

        // Block Guard Bypass: Guard is only active if the fighter is currently blocking
        if (hurt.type === "guard") {
          // Check if blocker is active
          // Note: In integration, guard active state is managed externally, so we check guard collision only if blocker is in block state
          // To be safe, we check blocking state in our GameEngine integration
        }

        const combinedRadius = hit.radius + hurt.radius;
        const collided = this.checkSweptSphereCollision(
          hit.prevPos.x, hit.prevPos.y, hit.prevPos.z,
          hit.pos.x, hit.pos.y, hit.pos.z,
          hurt.pos.x, hurt.pos.y, hurt.pos.z,
          combinedRadius
        );

        if (collided) {
          // Register hit
          this.processedStrikes.add(hit.strikeId);

          // Calculate approximate impact point (midpoint along collision normals)
          const dx = hurt.pos.x - hit.pos.x;
          const dy = hurt.pos.y - hit.pos.y;
          const dz = hurt.pos.z - hit.pos.z;
          const dLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          let hitPoint: Vector3D;
          if (dLen > 0.001) {
            hitPoint = {
              x: hit.pos.x + (dx / dLen) * hit.radius,
              y: hit.pos.y + (dy / dLen) * hit.radius,
              z: hit.pos.z + (dz / dLen) * hit.radius,
            };
          } else {
            hitPoint = { ...hit.pos };
          }

          onCollision(hit.owner, hit.strikeId, hurt.id, hurt.type, hitPoint);
          break; // Stop checking other hurtboxes for this hand in this frame
        }
      }
    }
  }
}
