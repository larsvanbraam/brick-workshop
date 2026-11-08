import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Assembly } from '@lego-builder/brick-engine';
import type { CinematicMood } from '../cinematic-look';
import { ManualRenderer } from './renderer';

export interface BoxDetails {
  title: string;
  subtitle: string;
  age: string;
  setNumber: string;
  description: string;
  mood: CinematicMood;
}

export interface BoxArt {
  /** The box standing on a transparent background, as a PNG. */
  box: string;
  /** The flat front panel, as a PNG. */
  front: string;
}

/** Front panel size in pixels; the box is as deep as DEPTH. */
const WIDTH = 1600;
const HEIGHT = 1400;
const DEPTH = 420;
/** Where the dark strip of detail shots starts, as a share of the front's height. */
const BAND = 0.77;
const INK = '#0b0c0f';
const SERIF = `Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** A five-digit set number that stays the same for the same build name. */
export function setNumberFor(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return String(10000 + (hash % 90000));
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')!] as const;
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest font size up to `max` at which the text fits on one line. */
function fit(
  context: CanvasRenderingContext2D,
  text: string,
  font: (size: number) => string,
  width: number,
  max: number,
) {
  let size = max;
  for (; size > 12; size -= 2) {
    context.font = font(size);
    if (context.measureText(text).width <= width) break;
  }
  return size;
}

/** The Brick Workshop mark: a white two-stud brick and the name on the app's green. */
function brandMark(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, '#2a9a67');
  gradient.addColorStop(1, '#1f7a52');
  context.fillStyle = gradient;
  context.beginPath();
  context.roundRect(x, y, size, size, size * 0.16);
  context.fill();
  context.fillStyle = '#ffffff';
  const brick = { x: x + size * 0.2, y: y + size * 0.3, width: size * 0.6, height: size * 0.26 };
  for (const offset of [0.27, 0.73]) {
    context.beginPath();
    context.roundRect(
      brick.x + brick.width * offset - size * 0.08,
      brick.y - size * 0.08,
      size * 0.16,
      size * 0.1,
      size * 0.02,
    );
    context.fill();
  }
  context.beginPath();
  context.roundRect(brick.x, brick.y, brick.width, brick.height, size * 0.03);
  context.fill();
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.font = `800 ${size * 0.105}px ${SANS}`;
  context.letterSpacing = `${size * 0.01}px`;
  context.fillText('BRICK', x + size / 2, y + size * 0.74);
  context.fillText('WORKSHOP', x + size / 2, y + size * 0.87);
  context.letterSpacing = '0px';
}

/** A four-leaf flourish to crown the title, drawn in thin white strokes. */
function ornament(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.save();
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = Math.max(1.5, size * 0.035);
  for (let leaf = 0; leaf < 4; leaf++) {
    const angle = (leaf * Math.PI) / 2 - Math.PI / 2;
    context.beginPath();
    context.ellipse(
      x + Math.cos(angle) * size * 0.27,
      y + Math.sin(angle) * size * 0.27,
      size * 0.25,
      size * 0.11,
      angle,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  context.beginPath();
  context.moveTo(x, y - size * 0.07);
  context.lineTo(x + size * 0.07, y);
  context.lineTo(x, y + size * 0.07);
  context.lineTo(x - size * 0.07, y);
  context.closePath();
  context.fill();
  context.restore();
}

function rule(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  context.save();
  context.fillStyle = 'rgba(255, 255, 255, 0.55)';
  context.fillRect(x, y, width, 2);
  context.restore();
}

function front(renderer: ManualRenderer, details: BoxDetails, pieces: number) {
  const [panel, context] = canvas(WIDTH, HEIGHT);
  const band = Math.round(HEIGHT * BAND);
  const left = WIDTH * 0.06;
  const column = WIDTH * 0.16;
  const mark = WIDTH * 0.12;
  const titleX = WIDTH * 0.66;
  const titleY = HEIGHT * 0.14;
  const title = details.title.toUpperCase();
  context.letterSpacing = '6px';
  const titleSize = fit(context, title, (size) => `${size}px ${SERIF}`, WIDTH * 0.56, 92);
  const titleWidth = context.measureText(title).width;
  context.letterSpacing = '0px';
  context.font = `600 28px ${SANS}`;
  const name = wrap(context, details.title, column).slice(0, 2);

  // The model fills the whole panel above the strip, kept out of the title and the facts column.
  const margin = WIDTH * 0.015;
  const keepClear = [
    {
      x: 0,
      y: 0,
      width: left + column + margin,
      height: HEIGHT * 0.06 + mark + 250 + name.length * 34 + margin,
    },
    {
      x: titleX - titleWidth / 2 - margin,
      y: 0,
      width: titleWidth + margin * 2,
      height: titleY + (details.subtitle ? titleSize * 0.75 : titleSize * 0.25) + margin,
    },
  ];
  context.drawImage(
    renderer.renderCinematic(
      0,
      WIDTH,
      band,
      { x: WIDTH * 0.02, y: HEIGHT * 0.05, width: WIDTH * 0.96, height: band + HEIGHT * 0.06 },
      details.mood,
      // From just above street level across the water, so the model stands up against the sky;
      // the front of its base runs off under the strip, as a plinth would.
      { keepClear, elevation: 0.12, outdoor: true, street: true },
    ),
    0,
    0,
  );
  // A soft pool of black behind each block of text, so it reads over any sky or cloud.
  for (const area of keepClear) {
    const x = area.x + area.width / 2;
    const y = area.y + area.height / 2;
    const reach = Math.max(area.width, area.height) * 0.85;
    context.save();
    context.translate(x, y);
    context.scale(
      area.width / Math.max(area.width, area.height),
      area.height / Math.max(area.width, area.height),
    );
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, reach);
    glow.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
    glow.addColorStop(0.55, 'rgba(0, 0, 0, 0.45)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = glow;
    context.fillRect(-reach, -reach, reach * 2, reach * 2);
    context.restore();
  }

  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.letterSpacing = '6px';
  context.font = `${titleSize}px ${SERIF}`;
  context.fillText(title, titleX, titleY);
  ornament(context, titleX, titleY - titleSize * 0.72 - HEIGHT * 0.035, HEIGHT * 0.05);
  if (details.subtitle) {
    const subtitle = details.subtitle.toUpperCase();
    context.letterSpacing = '8px';
    context.font = `${titleSize * 0.32}px ${SERIF}`;
    const half = context.measureText(subtitle).width / 2;
    const y = titleY + titleSize * 0.75;
    context.fillText(subtitle, titleX, y);
    const lineY = y - titleSize * 0.11;
    rule(context, titleX - half - WIDTH * 0.1, lineY, WIDTH * 0.08);
    rule(context, titleX + half + WIDTH * 0.02, lineY, WIDTH * 0.08);
  }
  context.letterSpacing = '0px';

  brandMark(context, left, HEIGHT * 0.06, mark);
  context.textAlign = 'left';
  context.fillStyle = '#ffffff';
  let y = HEIGHT * 0.06 + mark + 80;
  context.font = `700 64px ${SANS}`;
  context.fillText(details.age, left, y);
  rule(context, left, y + 20, column);
  y += 72;
  context.font = `700 38px ${SANS}`;
  context.fillText(details.setNumber, left, y);
  rule(context, left, y + 18, column);
  y += 56;
  context.font = `600 28px ${SANS}`;
  for (const line of name) {
    context.fillText(line, left, y);
    y += 34;
  }
  rule(context, left, y - 14, column);
  y += 42;
  context.font = `700 46px ${SANS}`;
  context.fillText(String(pieces), left, y);
  const count = context.measureText(String(pieces)).width;
  context.font = `400 34px ${SANS}`;
  context.fillText(' pcs', left + count, y);

  context.fillStyle = INK;
  context.fillRect(0, band, WIDTH, HEIGHT - band);
  const padding = WIDTH * 0.03;
  const shotHeight = HEIGHT - band - padding * 2;
  const shotWidth = Math.round(WIDTH * 0.17);
  let x = padding;
  for (const { view, bounds } of renderer.closeUps(3)) {
    const image = renderer.renderCinematic(
      view,
      shotWidth,
      Math.round(shotHeight),
      { x: 0, y: 0, width: shotWidth, height: shotHeight },
      details.mood,
      { detail: bounds, elevation: 0.3, outdoor: true },
    );
    context.save();
    context.beginPath();
    context.roundRect(x, band + padding, shotWidth, shotHeight, 6);
    context.clip();
    context.drawImage(image, x, band + padding);
    context.restore();
    x += shotWidth + padding * 0.7;
  }
  const artWidth = Math.round(WIDTH * 0.17);
  const artX = WIDTH - padding - artWidth;
  const caption = details.subtitle.toUpperCase();
  const artHeight = Math.round(shotHeight - (caption ? 44 : 0));
  context.drawImage(renderer.renderLineArt(0, artWidth, artHeight), artX, band + padding);
  if (caption) {
    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    context.textAlign = 'center';
    context.letterSpacing = '5px';
    context.font = `18px ${SERIF}`;
    context.fillText(caption, artX + artWidth / 2, band + padding + shotHeight - 6);
    context.letterSpacing = '0px';
    context.textAlign = 'left';
  }

  const textX = x + padding * 0.3;
  const textWidth = artX - padding * 0.8 - textX;
  context.fillStyle = '#ffffff';
  fit(context, details.title, (size) => `600 ${size}px ${SANS}`, textWidth, 30);
  let textY = band + padding + 30;
  context.fillText(details.title, textX, textY);
  textY += 14;
  context.font = `400 22px ${SANS}`;
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const lines = wrap(context, details.description, textWidth);
  const room = Math.floor((HEIGHT - padding - textY) / 29);
  for (const line of lines.slice(0, room)) {
    textY += 29;
    context.fillText(line, textX, textY);
  }
  return panel;
}

function side(renderer: ManualRenderer, details: BoxDetails) {
  const [panel, context] = canvas(DEPTH, HEIGHT);
  context.fillStyle = INK;
  context.fillRect(0, 0, DEPTH, HEIGHT);
  const mark = DEPTH * 0.34;
  brandMark(context, (DEPTH - mark) / 2, DEPTH * 0.12, mark);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.letterSpacing = '4px';
  const words = details.title.toUpperCase().split(/\s+/).filter(Boolean);
  const longest = words.reduce((a, b) => (a.length >= b.length ? a : b), '');
  const size = fit(context, longest, (value) => `${value}px ${SERIF}`, DEPTH * 0.8, 64);
  context.font = `${size}px ${SERIF}`;
  let y = DEPTH * 0.12 + mark + size * 1.6;
  for (const word of words.slice(0, 4)) {
    context.fillText(word, DEPTH / 2, y);
    y += size * 1.15;
  }
  if (details.subtitle) {
    context.font = `${size * 0.4}px ${SERIF}`;
    context.fillText(details.subtitle.toUpperCase(), DEPTH / 2, y + size * 0.1);
  }
  context.letterSpacing = '0px';
  const art = Math.round(HEIGHT * 0.3);
  context.drawImage(
    renderer.renderLineArt(0, Math.round(DEPTH * 0.8), art),
    DEPTH * 0.1,
    HEIGHT - art - DEPTH * 0.2,
  );
  return panel;
}

function lid(details: BoxDetails) {
  const [panel, context] = canvas(WIDTH, DEPTH);
  context.fillStyle = INK;
  context.fillRect(0, 0, WIDTH, DEPTH);
  const mark = DEPTH * 0.42;
  brandMark(context, DEPTH * 0.2, (DEPTH - mark) / 2, mark);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.letterSpacing = '6px';
  const title = details.title.toUpperCase();
  fit(context, title, (size) => `${size}px ${SERIF}`, WIDTH * 0.6, 72);
  context.fillText(title, WIDTH * 0.58, DEPTH / 2);
  context.letterSpacing = '0px';
  return panel;
}

function texture(source: HTMLCanvasElement, renderer: WebGLRenderer) {
  const map = new CanvasTexture(source);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return map;
}

/** The panels folded into a box, seen from the front left like a product photo. */
function photograph(faces: {
  front: HTMLCanvasElement;
  side: HTMLCanvasElement;
  lid: HTMLCanvasElement;
}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(1800, 1600, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.35;
  room.dispose();
  pmrem.dispose();

  const [width, height, depth] = [WIDTH / 1000, HEIGHT / 1000, DEPTH / 1000];
  const geometry = new BoxGeometry(width, height, depth);
  const maps = [
    texture(faces.side, renderer),
    texture(faces.front, renderer),
    texture(faces.lid, renderer),
  ];
  const [sideMap, frontMap, lidMap] = maps;
  // The lid's texture would otherwise read upside down from the front.
  lidMap.center.set(0.5, 0.5);
  lidMap.rotation = Math.PI;
  const plain = new MeshStandardMaterial({ color: INK, roughness: 0.5 });
  const printed = (map: CanvasTexture) => new MeshStandardMaterial({ map, roughness: 0.42 });
  // BoxGeometry's faces run +x, -x, +y, -y, +z, -z.
  const materials = [plain, printed(sideMap), printed(lidMap), plain, printed(frontMap), plain];
  const box = new Mesh(geometry, materials);
  box.position.y = height / 2;
  box.castShadow = true;
  const floorGeometry = new PlaneGeometry(20, 20);
  const floorMaterial = new ShadowMaterial({ opacity: 0.22 });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(-1.5, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
  const fill = new DirectionalLight(0xffffff, 0.6);
  fill.position.set(3, 1.5, 2);
  scene.add(box, floor, key, fill, new AmbientLight(0xffffff, 0.5));

  const camera = new PerspectiveCamera(24, 1800 / 1600, 0.1, 50);
  const sphere = new Box3().setFromObject(box).getBoundingSphere(new Sphere());
  const direction = new Vector3(-0.42, 0.2, 1).normalize();
  camera.position
    .copy(sphere.center)
    .addScaledVector(direction, sphere.radius / Math.sin((12 * Math.PI) / 180));
  camera.lookAt(sphere.center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  geometry.dispose();
  floorGeometry.dispose();
  floorMaterial.dispose();
  for (const material of new Set(materials)) material.dispose();
  for (const map of maps) map.dispose();
  scene.environment?.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}

const pause = () => new Promise((resolve) => setTimeout(resolve));

/** Renders box art for a build: the front panel and the whole box as a product shot. */
export async function createBoxArt(
  assembly: Assembly,
  details: BoxDetails,
  onProgress: (label: string) => void,
): Promise<BoxArt> {
  onProgress('Loading parts');
  const { renderer } = await ManualRenderer.create(assembly);
  try {
    renderer.placeAll();
    onProgress('Shooting the front');
    await pause();
    const frontPanel = front(renderer, details, assembly.bricks.length);
    onProgress('Shooting the side');
    await pause();
    const sidePanel = side(renderer, details);
    onProgress('Folding the box');
    await pause();
    return {
      front: frontPanel.toDataURL('image/png'),
      box: photograph({ front: frontPanel, side: sidePanel, lid: lid(details) }),
    };
  } finally {
    renderer.dispose();
  }
}
