import { useEffect, useState } from 'react';
import type { Group } from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { PARTS } from '@lego-builder/brick-engine';
import type { LibraryCatalog } from '../tooling/ldraw-library';
import { COLOR_CONFIG, cloneLDrawModel } from './ldraw-materials';

const modelLoaders = new WeakMap<Group, LDrawLoader>();

export function coloredLDrawModel(model: Group, color: number): Group {
  const loader = modelLoaders.get(model);
  if (!loader) throw new Error('Missing material library for LDraw model.');
  return cloneLDrawModel(model, color, loader);
}

const colorConfigUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(COLOR_CONFIG)}`;

type Library = {
  status: 'loading' | 'ready' | 'fallback';
  models: Record<string, Group>;
  message: string;
};

let pendingLibrary: Promise<Record<string, Group>> | undefined;
let pendingCatalog: Promise<LibraryCatalog> | undefined;

export function loadLDrawCatalog(): Promise<LibraryCatalog> {
  pendingCatalog ??= fetch('/ldraw/catalog.json')
    .then(async (response) => {
      if (!response.ok) throw new Error('The local parts catalog could not be read.');
      return response.json() as Promise<LibraryCatalog>;
    })
    .catch((error: unknown) => {
      pendingCatalog = undefined;
      throw error;
    });
  return pendingCatalog;
}

export async function loadLDrawPart(id: string): Promise<Group> {
  let response = await fetch(`/ldraw/preview/${encodeURIComponent(id)}/manifest.json`);
  if (
    (!response.ok || !response.headers.get('content-type')?.includes('application/json')) &&
    PARTS.some((part) => part.id === id)
  )
    response = await fetch('/ldraw/manifest.json');
  if (response.status >= 500)
    throw new Error('The local library could not load this part or its dependencies.');
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw new Error('This preview needs the local library server.');
  const manifest = (await response.json()) as {
    available: boolean;
    fileMap: Record<string, string>;
  };
  if (!manifest.available) throw new Error('LDraw library is unavailable.');
  const loader = new LDrawLoader();
  loader.setPartsLibraryPath('/ldraw/');
  loader.setFileMap(manifest.fileMap);
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  await loader.preloadMaterials(colorConfigUrl);
  const model = await loader.loadAsync(`/ldraw/parts/${encodeURIComponent(id)}.dat`);
  modelLoaders.set(model, loader);
  return model;
}

export async function loadLDrawModels(): Promise<Record<string, Group>> {
  const response = await fetch('/ldraw/manifest.json');
  if (!response.ok) throw new Error('Local LDraw library could not be read.');
  const manifest = (await response.json()) as {
    available: boolean;
    fileMap: Record<string, string>;
    message?: string;
  };
  if (!manifest.available) throw new Error(manifest.message || 'Local LDraw library is missing.');
  const loader = new LDrawLoader();
  loader.setPartsLibraryPath('/ldraw/');
  loader.setFileMap(manifest.fileMap);
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  await loader.preloadMaterials(colorConfigUrl);
  const entries = await Promise.all(
    PARTS.map(async (part) => {
      const model = await loader.loadAsync(`/ldraw/parts/${part.id}.dat`);
      modelLoaders.set(model, loader);
      return [part.id, model] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function useLDrawLibrary(): Library {
  const [library, setLibrary] = useState<Library>({
    status: 'loading',
    models: {},
    message: 'Loading LDraw geometry',
  });
  useEffect(() => {
    let cancelled = false;
    pendingLibrary ??= loadLDrawModels();
    pendingLibrary
      .then((models) => {
        if (!cancelled)
          setLibrary({
            status: 'ready',
            models,
            message: `LDraw geometry / ${Object.keys(models).length} parts`,
          });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLibrary({
            status: 'fallback',
            models: {},
            message: error instanceof Error ? error.message : 'LDraw loading failed.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return library;
}
