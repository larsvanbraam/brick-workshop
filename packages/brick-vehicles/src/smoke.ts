import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';

/**
 * Puffs of smoke for a steam locomotive's chimney: a pool of soft grey balls that rise from the
 * chimney, drift back and the wind, swell and fade. They live in the scene's own space, so a puff
 * stays where it was let go as the train rides on.
 */

const POOL = 36;
/** Seconds a puff lasts. */
const LIFE = 2.6;

interface Puff {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  alive: boolean;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

export class Smoke {
  readonly group = new Group();
  private readonly puffs: Puff[];
  private readonly geometry = new SphereGeometry(1, 8, 6);
  private carry = 0;
  private seed = 1;

  constructor() {
    this.puffs = Array.from({ length: POOL }, () => {
      const material = new MeshBasicMaterial({
        color: 0xd8d8d8,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, material, age: 0, alive: false, vx: 0, vy: 0, vz: 0, size: 1 };
    });
  }

  private random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * Lets `rate` puffs a second out of the chimney at a point of the scene, for `delta` seconds, the
   * smoke carried along at the train's own velocity.
   */
  emit(
    delta: number,
    at: { x: number; y: number; z: number },
    rate: number,
    velocity: { x: number; z: number },
  ) {
    this.carry += rate * delta;
    while (this.carry >= 1) {
      this.carry -= 1;
      const puff = this.puffs.find((entry) => !entry.alive);
      if (!puff) return;
      puff.alive = true;
      puff.age = 0;
      puff.size = 0.45 + this.random() * 0.2;
      puff.vx = velocity.x * 0.8 + (this.random() - 0.5) * 0.5;
      puff.vz = velocity.z * 0.8 + (this.random() - 0.5) * 0.5;
      puff.vy = 2.4 + this.random() * 0.8;
      puff.mesh.position.set(
        at.x + (this.random() - 0.5) * 0.3,
        at.y,
        at.z + (this.random() - 0.5) * 0.3,
      );
      puff.mesh.visible = true;
    }
  }

  /** Ages and moves the puffs; returns whether any is still in the air, so the scene keeps drawing. */
  step(delta: number) {
    let any = false;
    for (const puff of this.puffs) {
      if (!puff.alive) continue;
      puff.age += delta;
      if (puff.age >= LIFE) {
        puff.alive = false;
        puff.mesh.visible = false;
        continue;
      }
      any = true;
      const t = puff.age / LIFE;
      // Rising slows as it cools, and it drifts on the wind.
      puff.vy *= 1 - Math.min(1, delta * 0.7);
      puff.mesh.position.x += puff.vx * delta + delta * 0.4;
      puff.mesh.position.y += puff.vy * delta;
      puff.mesh.position.z += puff.vz * delta;
      puff.vx *= 1 - Math.min(1, delta * 0.5);
      puff.vz *= 1 - Math.min(1, delta * 0.5);
      puff.mesh.scale.setScalar(puff.size * (1 + t * 2.4));
      puff.material.opacity = 0.78 * (1 - t) ** 1.4;
      // Dark at the chimney, pale as it spreads.
      puff.material.color.setScalar(0.45 + t * 0.5);
    }
    return any;
  }

  dispose() {
    this.geometry.dispose();
    for (const puff of this.puffs) puff.material.dispose();
  }
}
