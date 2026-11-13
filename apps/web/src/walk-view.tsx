import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, Group, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Brick } from '@brick-workshop/engine';
import { coloredLDrawModel, loadLDrawModels } from './ldraw';
import { MINIFIG_PARTS } from './minifig-parts';
import { LDRAW_SCALE } from './scene-frame';
import { MINIFIG, WalkWorld, spawnWalker, stepWalker } from './walk';

export type WalkCamera = 'first' | 'third';

const LOOK_SPEED = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;
/** How far behind the minifigure the third-person camera hangs. */
const FOLLOW_DISTANCE = 8;
const WALK_FOV = 70;

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  /** In the air Shift sinks, as Space climbs. */
  sink: ['KeyC', 'ShiftLeft', 'ShiftRight'],
  fly: ['KeyF'],
};
/**
 * Two taps of Space this close together take off or land, as F does; two taps of forward sprint
 * until it is let go.
 */
const DOUBLE_TAP = 300;
const HANDLED = new Set(Object.values(KEYS).flat());

/**
 * Walks a minifigure through the build: WASD or the arrows move, the mouse looks round once the
 * pointer is locked by a click, Space jumps and Shift runs. F or a double tap of Space takes off;
 * in the air Space climbs and C sinks. Takes the camera over while mounted.
 */
export function WalkMode({
  bricks,
  buildArea,
  view,
  flying,
  onFlyingChange,
}: {
  bricks: Iterable<Brick>;
  buildArea: number;
  view: WalkCamera;
  flying: boolean;
  onFlyingChange: (flying: boolean) => void;
}) {
  const { camera, gl, invalidate } = useThree();
  const world = useMemo(() => new WalkWorld(bricks, buildArea), [bricks, buildArea]);
  const [spawn] = useState(() => spawnWalker(world, buildArea));
  const walker = useRef(spawn);
  const look = useRef({ yaw: 0, pitch: -0.08 });
  const held = useRef(new Set<string>());
  const jumpQueued = useRef(false);
  const eyeY = useRef(spawn.y + MINIFIG.eye);
  const stride = useRef(0);
  const figure = useRef<MinifigRig>({
    forward: 1,
    root: null,
    leftLeg: null,
    rightLeg: null,
    leftArm: null,
    rightArm: null,
  });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
    invalidate();
  }, [view, invalidate]);
  const fly = useRef({
    flying,
    onFlyingChange,
    lastSpace: -Infinity,
    lastForward: -Infinity,
    sprint: false,
  });
  useEffect(() => {
    fly.current.flying = flying;
    fly.current.onFlyingChange = onFlyingChange;
    walker.current.flying = flying;
    invalidate();
  }, [flying, onFlyingChange, invalidate]);
  // The real minifigure from the LDraw library; a stand-in walks until it has loaded, or for good
  // when the library has no minifigure parts.
  const [models, setModels] = useState<Record<string, Group> | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadLDrawModels(MINIFIG_PARTS)
      .then((loaded) => {
        if (!cancelled) setModels(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const ldrawFigure = useMemo(() => (models ? assembleMinifig(models) : null), [models]);
  useEffect(() => {
    if (!ldrawFigure) return;
    const previous = figure.current;
    figure.current = ldrawFigure;
    return () => {
      figure.current = previous;
    };
  }, [ldrawFigure]);

  // A changed build keeps the walker where it is, lifted out of anything now in its way.
  useEffect(() => {
    const current = walker.current;
    current.y = world.standingHeight(current.x, current.z, current.y);
  }, [world]);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const { fov, near } = camera;
    camera.fov = WALK_FOV;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    return () => {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  useEffect(() => {
    const element = gl.domElement;
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!HANDLED.has(event.code)) return;
      event.preventDefault();
      // Keeps the workshop's own shortcuts (Space pans, F frames) out of it.
      event.stopImmediatePropagation();
      const toggle = () => fly.current.onFlyingChange(!fly.current.flying);
      if (KEYS.fly.includes(event.code) && !event.repeat) toggle();
      if (KEYS.jump.includes(event.code) && !event.repeat) {
        jumpQueued.current = true;
        const now = performance.now();
        if (now - fly.current.lastSpace < DOUBLE_TAP) {
          toggle();
          fly.current.lastSpace = -Infinity;
        } else fly.current.lastSpace = now;
      }
      if (KEYS.forward.includes(event.code) && !event.repeat) {
        const now = performance.now();
        if (now - fly.current.lastForward < DOUBLE_TAP) fly.current.sprint = true;
        fly.current.lastForward = now;
      }
      held.current.add(event.code);
      invalidate();
    };
    const keyup = (event: KeyboardEvent) => {
      held.current.delete(event.code);
      if (KEYS.forward.includes(event.code)) fly.current.sprint = false;
    };
    const blur = () => held.current.clear();
    // A click locks the pointer for mouse look; where the page may not lock it (an embedded
    // frame), dragging looks round instead.
    const lock = () => {
      if (document.pointerLockElement === element || !element.requestPointerLock) return;
      Promise.resolve(element.requestPointerLock()).catch(() => {});
    };
    let dragging = false;
    const down = (event: PointerEvent) => {
      if (event.button === 0) dragging = true;
    };
    const up = () => {
      dragging = false;
    };
    const move = (event: MouseEvent) => {
      if (document.pointerLockElement !== element && !dragging) return;
      look.current.yaw -= event.movementX * LOOK_SPEED;
      look.current.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, look.current.pitch - event.movementY * LOOK_SPEED),
      );
    };
    // Capture: runs before the camera rig's listeners on the window.
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    element.addEventListener('click', lock);
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    document.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      element.removeEventListener('click', lock);
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      document.removeEventListener('mousemove', move);
      if (document.pointerLockElement === element) document.exitPointerLock();
    };
  }, [gl, invalidate]);

  const target = useMemo(() => new Vector3(), []);
  const behind = useMemo(() => new Vector3(), []);
  useFrame(({ clock }, delta) => {
    const keys = held.current;
    const pressed = (codes: string[]) => codes.some((code) => keys.has(code));
    const current = walker.current;
    const fromX = current.x;
    const fromZ = current.z;
    const airborne = current.flying ?? false;
    stepWalker(
      world,
      current,
      {
        forward: (pressed(KEYS.forward) ? 1 : 0) - (pressed(KEYS.back) ? 1 : 0),
        strafe: (pressed(KEYS.right) ? 1 : 0) - (pressed(KEYS.left) ? 1 : 0),
        yaw: look.current.yaw,
        run: fly.current.sprint || (!airborne && pressed(KEYS.run)),
        jump: jumpQueued.current,
        rise: (pressed(KEYS.jump) ? 1 : 0) - (pressed(KEYS.sink) ? 1 : 0),
      },
      delta,
    );
    jumpQueued.current = false;
    // Sinking onto the ground lands.
    if (airborne && !current.flying) {
      fly.current.onFlyingChange(false);
    }
    const moved = Math.hypot(current.x - fromX, current.z - fromZ);
    // Steps up ease in, so climbing a terrace glides instead of jolting; falls follow at once.
    const eye = current.y + MINIFIG.eye;
    eyeY.current =
      eye < eyeY.current ? eye : eyeY.current + (eye - eyeY.current) * Math.min(1, delta * 14);
    stride.current = moved > 0.001 ? stride.current + moved * 1.6 : stride.current * 0.8;

    const { yaw, pitch } = look.current;
    const bob = current.grounded
      ? Math.sin(stride.current * 2) * 0.05 * Math.min(1, moved * 20)
      : 0;
    if (viewRef.current === 'first') {
      camera.position.set(current.x, eyeY.current + bob, current.z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      // Over the shoulder, pulled in where a wall is in the way.
      target.set(current.x, eyeY.current + 0.6, current.z);
      behind.set(
        Math.sin(yaw) * Math.cos(pitch),
        -Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
      let distance = 0;
      while (distance < FOLLOW_DISTANCE) {
        const next = distance + 0.25;
        const x = target.x + behind.x * next;
        const y = target.y + behind.y * next;
        const z = target.z + behind.z * next;
        if (y < 0.3 || world.contains(x, y, z)) break;
        distance = next;
      }
      distance = Math.max(0, distance - 0.3);
      camera.position.copy(target).addScaledVector(behind, distance);
      camera.lookAt(target);
    }

    const rig = figure.current;
    const body = rig.root;
    if (body) {
      body.visible = viewRef.current === 'third';
      body.position.set(current.x, eyeY.current - MINIFIG.eye, current.z);
      body.rotation.y = yaw;
      // Angles swing a limb forward when positive; the rig says which way that turns it.
      const pose = (limb: Group | null, angle: number) =>
        limb?.rotation.set(angle * rig.forward, 0, 0);
      if (current.flying) {
        // Upright, limbs swinging as if walking on air, and a slow sway while hovering.
        const swing = Math.sin(stride.current) * Math.min(0.5, moved * 18);
        const sway = Math.sin(clock.elapsedTime * 1.6) * 0.06;
        pose(rig.leftLeg, swing);
        pose(rig.rightLeg, -swing);
        pose(rig.leftArm, -swing * 0.8 + sway);
        pose(rig.rightArm, swing * 0.8 - sway);
      } else {
        const swing = Math.sin(stride.current) * Math.min(0.7, moved * 25);
        const air = current.grounded ? 0 : 0.5;
        pose(rig.leftLeg, swing + air);
        pose(rig.rightLeg, -swing - air * 0.4);
        pose(rig.leftArm, -swing * 0.8 + air);
        pose(rig.rightArm, swing * 0.8 + air);
      }
    }
    // Keeps drawing while walking: the canvas otherwise renders on demand.
    invalidate();
  });

  if (ldrawFigure) return <primitive object={ldrawFigure.root} />;
  return (
    <Minifig
      onPart={(part, node) => {
        figure.current[part] = node;
      }}
    />
  );
}

/** An LDraw transform line's position and matrix (`x y z a b c d e f g h i`). */
function ldrawMatrix(values: readonly number[]) {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = values;
  return new Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1);
}

function placed(object: Object3D, matrix: Matrix4) {
  matrix.decompose(object.position, object.quaternion, object.scale);
  return object;
}

/** Where the parts sit in a standard LDraw minifigure, torso at the origin. */
const RIGHT_ARM = ldrawMatrix([-15.552, 9, 0, 0.985, -0.17, 0, 0.17, 0.985, 0, 0, 0, 1]);
const LEFT_ARM = ldrawMatrix([15.552, 9, 0, 0.985, 0.17, 0, -0.17, 0.985, 0, 0, 0, 1]);
const RIGHT_HAND = ldrawMatrix([
  -23.69, 26.774, -9.898, 0.985, -0.12, 0.12, 0.17, 0.696, -0.696, 0, 0.707, 0.707,
]);
const LEFT_HAND = ldrawMatrix([
  23.69, 26.774, -9.898, 0.985, 0.12, -0.12, -0.17, 0.696, -0.696, 0, 0.707, 0.707,
]);

/** LDraw colour codes: yellow skin, a red shirt and blue trousers. */
const SKIN = 14;
const SHIRT_CODE = 4;
const TROUSERS_CODE = 1;

/**
 * The minifigure from its LDraw parts, feet at the origin and facing -z, with legs swinging from
 * the hips and arms from the shoulders.
 */
function assembleMinifig(models: Record<string, Group>): MinifigRig & { root: Group } {
  const part = (id: string, color: number) => coloredLDrawModel(models[id], color);
  const body = new Group();
  body.add(part('973', SHIRT_CODE));
  body.add(placed(part('3626cp01', SKIN), new Matrix4().makeTranslation(0, -24, 0)));
  body.add(placed(part('3815', TROUSERS_CODE), new Matrix4().makeTranslation(0, 32, 0)));
  const leg = (id: string) => {
    const pivot = new Group();
    pivot.position.set(0, 44, 0);
    pivot.add(part(id, TROUSERS_CODE));
    body.add(pivot);
    return pivot;
  };
  // Each arm turns about its shoulder and carries its hand along.
  const arm = (id: string, armMatrix: Matrix4, handMatrix: Matrix4) => {
    const shoulder = new Vector3().setFromMatrixPosition(armMatrix);
    const pivot = new Group();
    pivot.position.copy(shoulder);
    const toShoulder = new Matrix4().makeTranslation(-shoulder.x, -shoulder.y, -shoulder.z);
    pivot.add(placed(part(id, SHIRT_CODE), toShoulder.clone().multiply(armMatrix)));
    pivot.add(placed(part('3820', SKIN), toShoulder.multiply(handMatrix)));
    body.add(pivot);
    return pivot;
  };
  const rig = {
    rightLeg: leg('3816'),
    leftLeg: leg('3817'),
    rightArm: arm('3818', RIGHT_ARM, RIGHT_HAND),
    leftArm: arm('3819', LEFT_ARM, LEFT_HAND),
  };
  // LDraw's y points down and its front faces -z; the scene stands it upright (see LDRAW_SCALE),
  // which turns its front to +z, so it is turned round to face the way the walker looks.
  body.scale.set(...LDRAW_SCALE);
  body.rotation.y = Math.PI;
  const feet = new Box3().setFromObject(body).min.y;
  body.position.y = -feet;
  const root = new Group();
  root.visible = false;
  root.add(body);
  root.traverse((object) => {
    object.castShadow = false;
  });
  // LDraw's limbs hang down its +y and face -z, so a positive turn swings them back.
  return { forward: -1, root, ...rig };
}

interface MinifigRig {
  /** Which way a positive turn about x swings a limb: 1 forward, -1 back. */
  forward: number;
  root: Group | null;
  leftLeg: Group | null;
  rightLeg: Group | null;
  leftArm: Group | null;
  rightArm: Group | null;
}

const YELLOW = '#f2cd37';
const SHIRT = '#c91a09';
const TROUSERS = '#0055bf';
const HIPS = '#1b2a34';

/** A classic minifigure in scene units, feet at its origin, facing -z. */
function Minifig({
  onPart,
}: {
  onPart: (part: Exclude<keyof MinifigRig, 'forward'>, node: Group | null) => void;
}) {
  const plastic = { roughness: 0.35, metalness: 0 };
  const leg = (side: -1 | 1) => (
    // Legs swing from the hips.
    <group
      position={[side * 0.4, 1.75, 0]}
      ref={(node) => {
        onPart(side < 0 ? 'leftLeg' : 'rightLeg', node);
      }}
    >
      <mesh position={[0, -0.75, 0]}>
        <boxGeometry args={[0.76, 1.5, 0.9]} />
        <meshStandardMaterial color={TROUSERS} {...plastic} />
      </mesh>
      <mesh position={[0, -1.6, -0.15]}>
        <boxGeometry args={[0.76, 0.3, 1.2]} />
        <meshStandardMaterial color={TROUSERS} {...plastic} />
      </mesh>
    </group>
  );
  const arm = (side: -1 | 1) => (
    <group
      position={[side * 0.95, 3.35, 0]}
      ref={(node) => {
        onPart(side < 0 ? 'leftArm' : 'rightArm', node);
      }}
    >
      <group rotation={[0, 0, side * 0.12]}>
        <mesh position={[side * 0.08, -0.6, 0]}>
          <cylinderGeometry args={[0.24, 0.27, 1.3, 16]} />
          <meshStandardMaterial color={SHIRT} {...plastic} />
        </mesh>
        <mesh position={[side * 0.1, -1.35, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.08, 8, 16]} />
          <meshStandardMaterial color={YELLOW} {...plastic} />
        </mesh>
      </group>
    </group>
  );
  return (
    <group
      visible={false}
      ref={(node) => {
        onPart('root', node);
      }}
    >
      {leg(-1)}
      {leg(1)}
      <mesh position={[0, 1.95, 0]}>
        <boxGeometry args={[1.6, 0.4, 0.9]} />
        <meshStandardMaterial color={HIPS} {...plastic} />
      </mesh>
      {/* The torso narrows toward the shoulders. */}
      <mesh position={[0, 2.95, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1, 1, 0.55]}>
        <cylinderGeometry args={[0.85, 1.15, 1.6, 4]} />
        <meshStandardMaterial color={SHIRT} {...plastic} flatShading />
      </mesh>
      {arm(-1)}
      {arm(1)}
      <mesh position={[0, 3.85, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.2, 16]} />
        <meshStandardMaterial color={YELLOW} {...plastic} />
      </mesh>
      <mesh position={[0, 4.35, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.85, 24]} />
        <meshStandardMaterial color={YELLOW} {...plastic} />
      </mesh>
      <mesh position={[0, 4.85, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.17, 16]} />
        <meshStandardMaterial color={YELLOW} {...plastic} />
      </mesh>
      {/* Eyes and a smile on the front (-z). */}
      {[-0.17, 0.17].map((x) => (
        <mesh key={x} position={[x, 4.45, -0.49]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      ))}
      <mesh position={[0, 4.2, -0.47]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.16, 0.03, 6, 16, Math.PI]} />
        <meshBasicMaterial color="#111" />
      </mesh>
    </group>
  );
}
