import { memo, useEffect, useMemo, useSyncExternalStore } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshLambertMaterial } from 'three';
import type { FarChunk } from './world/far.ts';

/** Both sides: the z axis runs the other way in the scene, which turns some windings round. */
const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });

/**
 * A far chunk as one plain mesh, its triangles built off the main thread (see `farChunk`): only
 * handed to the GPU here, so a ring of them costs the page little.
 */
export function FarView({ chunk }: { chunk: FarChunk }) {
  const mesh = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(chunk.colors, 3));
    geometry.computeBoundingSphere();
    const built = new Mesh(geometry, material);
    built.raycast = () => {};
    return built;
  }, [chunk]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

/**
 * The far chunks, kept outside React state: one arrives nearly every frame while the walker moves,
 * and only the layer that draws them listens, so the rest of the scene is not redrawn each time.
 */
export class FarStore {
  private chunks: ReadonlyMap<string, FarChunk> = new Map();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.chunks;

  get current() {
    return this.chunks;
  }

  set(chunks: ReadonlyMap<string, FarChunk>) {
    this.chunks = chunks;
    for (const listener of this.listeners) listener();
  }
}

/** Every far chunk not yet loaded in full, each its own mesh. */
export const FarLayer = memo(function FarLayer({
  store,
  loaded,
}: {
  store: FarStore;
  /** Chunks loaded in full: their far look is hidden. */
  loaded: ReadonlyMap<string, unknown>;
}) {
  const chunks = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <>
      {[...chunks].map(([key, far]) =>
        loaded.has(key) ? null : <FarView key={key} chunk={far} />,
      )}
    </>
  );
});
