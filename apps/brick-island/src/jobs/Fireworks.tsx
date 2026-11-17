import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
} from 'three';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import { chime } from '@brick-workshop/game/chime.ts';

/** How many sparks can be alive at once. */
const MAX_SPARKS = 3000;
/** Sparks in one burst. */
const BURST = 110;
/** How long the show goes on, in seconds. */
const SHOW_SECONDS = 14;
/** Seconds between rockets. */
const GAP = 0.55;
const COLORS = [0xff4d4d, 0xffd23f, 0x4dd2ff, 0x7dff6b, 0xff7bf0, 0xffffff, 0xff9a3c].map(
  (hex) => new Color(hex),
);

interface Rocket {
  x: number;
  y: number;
  z: number;
  speed: number;
  top: number;
  color: Color;
}

/**
 * Fireworks over the walker: rockets climb from around them and burst into rings of sparks that
 * fall and fade. A show starts each time `show` goes up and lasts a few seconds.
 */
export function Fireworks({ show, probe }: { show: number; probe: { current: WalkProbe | null } }) {
  const state = useRef({
    shown: 0,
    elapsed: SHOW_SECONDS,
    next: 0,
    rockets: [] as Rocket[],
    cursor: 0,
  });
  const sparks = useMemo(() => {
    const position = new Float32Array(MAX_SPARKS * 3);
    const color = new Float32Array(MAX_SPARKS * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    const points = new Points(
      geometry,
      new PointsMaterial({
        size: 1.3,
        vertexColors: true,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    points.frustumCulled = false;
    return {
      points,
      position,
      color,
      velocity: new Float32Array(MAX_SPARKS * 3),
      life: new Float32Array(MAX_SPARKS),
      tint: new Float32Array(MAX_SPARKS * 3),
    };
  }, []);

  const burst = (x: number, y: number, z: number, tint: Color) => {
    const s = state.current;
    const { position, velocity, life, tint: tints } = sparks;
    const second = COLORS[Math.floor(Math.random() * COLORS.length)]!;
    for (let n = 0; n < BURST; n++) {
      const i = s.cursor;
      s.cursor = (s.cursor + 1) % MAX_SPARKS;
      // A point on a sphere, so the burst is round.
      const u = Math.random() * 2 - 1;
      const angle = Math.random() * Math.PI * 2;
      const ring = Math.sqrt(1 - u * u);
      const speed = 13 + Math.random() * 5;
      position.set([x, y, z], i * 3);
      velocity.set(
        [ring * Math.cos(angle) * speed, u * speed, ring * Math.sin(angle) * speed],
        i * 3,
      );
      const c = n % 3 === 0 ? second : tint;
      tints.set([c.r, c.g, c.b], i * 3);
      life[i] = 1.6 + Math.random() * 0.8;
    }
  };

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const s = state.current;
    const walker = probe.current?.walker;
    if (show !== s.shown) {
      s.shown = show;
      s.elapsed = 0;
      s.next = 0;
      chime('all');
    }
    const { position, color, velocity, life, tint } = sparks;
    if (s.elapsed < SHOW_SECONDS && walker) {
      s.elapsed += delta;
      s.next -= delta;
      if (s.next <= 0) {
        s.next = GAP * (0.5 + Math.random());
        const angle = Math.random() * Math.PI * 2;
        const radius = 18 + Math.random() * 30;
        s.rockets.push({
          x: walker.x + Math.cos(angle) * radius,
          y: walker.y,
          z: walker.z + Math.sin(angle) * radius,
          speed: 38 + Math.random() * 10,
          top: walker.y + 38 + Math.random() * 22,
          color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        });
      }
    }
    // Rockets climb with a little trail, then burst at the top.
    s.rockets = s.rockets.filter((rocket) => {
      rocket.y += rocket.speed * delta;
      const i = s.cursor;
      s.cursor = (s.cursor + 1) % MAX_SPARKS;
      position.set([rocket.x, rocket.y, rocket.z], i * 3);
      velocity.set([0, -4, 0], i * 3);
      tint.set([1, 0.85, 0.5], i * 3);
      life[i] = 0.5;
      if (rocket.y < rocket.top) return true;
      burst(rocket.x, rocket.y, rocket.z, rocket.color);
      return false;
    });
    for (let i = 0; i < MAX_SPARKS; i++) {
      const left = life[i]!;
      if (left <= 0) {
        color[i * 3] = color[i * 3 + 1] = color[i * 3 + 2] = 0;
        continue;
      }
      life[i] = left - delta;
      velocity[i * 3 + 1]! -= 9 * delta;
      position[i * 3]! += velocity[i * 3]! * delta;
      position[i * 3 + 1]! += velocity[i * 3 + 1]! * delta;
      position[i * 3 + 2]! += velocity[i * 3 + 2]! * delta;
      const fade = Math.min(1, left);
      color[i * 3] = tint[i * 3]! * fade;
      color[i * 3 + 1] = tint[i * 3 + 1]! * fade;
      color[i * 3 + 2] = tint[i * 3 + 2]! * fade;
    }
    const { attributes } = sparks.points.geometry;
    attributes.position!.needsUpdate = true;
    attributes.color!.needsUpdate = true;
  });
  return <primitive object={sparks.points} />;
}
