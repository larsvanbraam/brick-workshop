import { Group, LineSegments, Mesh } from 'three';
import type { Material } from 'three';
import type { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { COLORS } from '@brick-workshop/engine';
import type { LDrawColor } from '@brick-workshop/engine';

/**
 * Display colours that differ from LDraw's. LDraw draws Black as blue-grey #1B2A34 so edges stay
 * visible in line drawings; lit in 3D it reads as navy, while a real Black brick looks black
 * (BrickLink and Rebrickable list it as #05131D).
 */
const DISPLAY_HEX: Readonly<Record<number, string>> = { 0: '#05131d' };

export function displayHex(color: LDrawColor) {
  return DISPLAY_HEX[color.id] ?? color.hex;
}

const finishTokens: Record<string, string> = {
  chrome: 'CHROME',
  pearl: 'PEARLESCENT',
  metal: 'METAL',
  'matte-metal': 'MATTE_METALLIC',
  rubber: 'RUBBER',
};
export const COLOR_CONFIG = [
  '0 !COLOUR Main_Colour CODE 16 VALUE #FF8080 EDGE #333333',
  '0 !COLOUR Edge_Colour CODE 24 VALUE #A0A0A0 EDGE #333333',
  ...COLORS.map(
    (color) =>
      `0 !COLOUR ${color.name.replaceAll(' ', '_')} CODE ${color.id} VALUE ${displayHex(color)} EDGE ${color.edge} ALPHA ${color.alpha} LUMINANCE ${color.luminance}${color.material ? ` MATERIAL ${color.material}` : finishTokens[color.finish] ? ` ${finishTokens[color.finish]}` : ''}`,
  ),
].join('\n');

export function colorMaterialProperties(color: LDrawColor) {
  const finishes: Record<string, [number, number]> = {
    chrome: [0, 1],
    pearl: [0.3, 0.25],
    rubber: [0.9, 0],
    'matte-metal': [0.8, 0.4],
    metal: [0.2, 0.85],
  };
  const [roughness, metalness] = finishes[color.finish] ?? [0.3, 0];
  return {
    color: displayHex(color),
    roughness,
    metalness,
    opacity: color.alpha / 255,
    transparent: color.alpha < 255,
    depthWrite: color.alpha === 255,
    emissive: displayHex(color),
    emissiveIntensity: color.luminance / 255,
  };
}

export function cloneLDrawModel(model: Group, color: number, loader: LDrawLoader): Group {
  if (!loader.getMaterial(String(color))) throw new Error(`Missing LDraw material: ${color}`);
  const clone = model.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    const remap = (material: Material) => {
      const code = String(material.userData.code);
      return code === '16' || (object instanceof LineSegments && code === '24')
        ? ((object instanceof LineSegments ? '24' : '16') as unknown as Material)
        : material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(remap)
      : remap(object.material);
  });
  const colorLoader = loader as LDrawLoader & {
    applyMaterialsToMesh(
      group: Group,
      code: string,
      hierarchy: Record<string, Material>,
      final: boolean,
    ): void;
  };
  colorLoader.applyMaterialsToMesh(clone, String(color), {}, true);
  clone.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
    object.castShadow = object instanceof Mesh;
    object.receiveShadow = object instanceof Mesh;
  });
  return clone;
}
