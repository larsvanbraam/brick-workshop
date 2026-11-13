import { useEffect, useMemo, useState } from 'react';
import type { Group } from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { PARTS } from '@brick-workshop/engine';
import type { LibraryCatalog } from '../tooling/ldraw-library';
import { COLOR_CONFIG, cloneLDrawModel } from './ldraw-materials';
import { MINIFIG_PARTS } from './minifig-parts';

const modelLoaders = new WeakMap<Group, LDrawLoader>();
const pendingPartModels = new Map<string, Promise<Group>>();

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
  /**
   * Required parts still on their way. Bricks of these parts have nothing to show yet: drawing
   * them as fallback shapes first would build thousands of throwaway meshes for a big model.
   */
  pending: readonly string[];
};

let pendingCatalog: Promise<LibraryCatalog> | undefined;

/** Release builds only ship curated parts, so the library browser hides everything else. */
export const CURATED_PARTS_ONLY = import.meta.env.PROD;

function curatedOnly(catalog: LibraryCatalog): LibraryCatalog {
  const parts = catalog.parts.filter((part) => part.supported);
  return {
    ...catalog,
    parts,
    categories: [...new Set(parts.map((part) => part.category))].sort(),
  };
}

export function loadLDrawCatalog(): Promise<LibraryCatalog> {
  pendingCatalog ??= fetch('/ldraw/catalog.json')
    .then(async (response) => {
      if (!response.ok) throw new Error('The local parts catalog could not be read.');
      const catalog = (await response.json()) as LibraryCatalog;
      return CURATED_PARTS_ONLY ? curatedOnly(catalog) : catalog;
    })
    .catch((error: unknown) => {
      pendingCatalog = undefined;
      throw error;
    });
  return pendingCatalog;
}

async function loadPreviewPart(id: string): Promise<Group> {
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

async function loadSupportedModels(partIds: readonly string[]): Promise<Record<string, Group>> {
  let response = await fetch(`/ldraw/manifest.json?parts=${encodeURIComponent(partIds.join(','))}`);
  if (
    response.status < 500 &&
    (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
  )
    response = await fetch('/ldraw/manifest.json');
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
    partIds.map(async (id) => {
      const model = await loader.loadAsync(`/ldraw/parts/${id}.dat`);
      modelLoaders.set(model, loader);
      return [id, model] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function loadLDrawModels(
  partIds: readonly string[] = PARTS.map((part) => part.id),
): Promise<Record<string, Group>> {
  const ids = [...new Set(partIds)];
  const missing = ids.filter((id) => !pendingPartModels.has(id));
  const supported = missing.filter(
    (id) => MINIFIG_PARTS.includes(id) || PARTS.some((part) => part.id === id),
  );
  if (supported.length) {
    const batch = loadSupportedModels(supported);
    for (const id of supported)
      pendingPartModels.set(
        id,
        batch
          .then((models) => models[id])
          .catch((error: unknown) => {
            pendingPartModels.delete(id);
            throw error;
          }),
      );
  }
  for (const id of missing.filter((id) => !supported.includes(id)))
    pendingPartModels.set(
      id,
      loadPreviewPart(id).catch((error: unknown) => {
        pendingPartModels.delete(id);
        throw error;
      }),
    );
  return Promise.all(ids.map(async (id) => [id, await pendingPartModels.get(id)!] as const)).then(
    (entries) => Object.fromEntries(entries),
  );
}

export function loadLDrawPart(id: string): Promise<Group> {
  return loadLDrawModels([id]).then((models) => models[id]);
}

export function useLDrawLibrary(requiredParts: readonly string[]): Library {
  const requiredKey = [...new Set(requiredParts)].sort().join('\0');
  const [library, setLibrary] = useState<Omit<Library, 'pending'> & { failed: readonly string[] }>({
    status: 'loading',
    models: {},
    message: 'Loading LDraw geometry',
    failed: [],
  });
  // The last request that settled; parts of a newer one are pending until it settles too.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ids = requiredKey ? requiredKey.split('\0') : [];
    loadLDrawModels(ids)
      .then((models) => {
        if (cancelled) return;
        setLibrary((current) => ({
          status: 'ready',
          models: { ...current.models, ...models },
          message: `LDraw geometry / ${Object.keys({ ...current.models, ...models }).length} parts`,
          failed: current.failed.filter((id) => !(id in models)),
        }));
        setSettledKey(requiredKey);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLibrary((current) => ({
          status: Object.keys(current.models).length ? current.status : 'fallback',
          models: current.models,
          message: error instanceof Error ? error.message : 'LDraw loading failed.',
          // Whatever didn't arrive is drawn from fallback shapes rather than waited on forever.
          failed: [...new Set([...current.failed, ...ids.filter((id) => !(id in current.models))])],
        }));
        setSettledKey(requiredKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requiredKey]);
  const pending = useMemo(() => {
    if (settledKey === requiredKey || !requiredKey) return [];
    const failed = new Set(library.failed);
    return requiredKey.split('\0').filter((id) => !(id in library.models) && !failed.has(id));
  }, [requiredKey, settledKey, library.models, library.failed]);
  return useMemo(
    () => ({
      status: library.status,
      models: library.models,
      message: library.message,
      pending,
    }),
    [library.status, library.models, library.message, pending],
  );
}
