import { useEffect, useState } from 'react';
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  LineSegments,
  Mesh,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { coloredLDrawModel, loadLDrawModels } from './ldraw';

/** Square pixel size of a thumbnail: twice the picker's visual, for sharp high-DPI tiles. */
const SIZE = 128;
/** Light bluish grey, so every part reads the same regardless of the active color. */
const THUMBNAIL_COLOR = 71;
/** Looking down from the front left, like the picker's flat stud blocks. */
const VIEW = new Vector3(-1, 1.1, 1.6).normalize();

type Stage = { renderer: WebGLRenderer; scene: Scene; camera: OrthographicCamera };

const thumbnails = new Map<string, Promise<string | null>>();
const queued = new Map<string, (url: string | null) => void>();
let stage: Stage | undefined;
let flushing = false;

function getStage(): Stage {
  if (stage) return stage;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new Scene();
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment).texture;
  environment.dispose();
  pmrem.dispose();
  scene.add(new AmbientLight(0xffffff, 0.5));
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(-8, 12, 10);
  const fill = new DirectionalLight(0xffffff, 0.7);
  fill.position.set(10, 3, -8);
  scene.add(key, fill);
  stage = { renderer, scene, camera: new OrthographicCamera() };
  return stage;
}

function render(model: Group): string {
  const { renderer, scene, camera } = getStage();
  const instance = coloredLDrawModel(model, THUMBNAIL_COLOR);
  // LDraw's y axis points down; turned half round x so the part isn't mirrored.
  const root = new Group();
  root.scale.set(1, -1, -1);
  root.add(instance);
  scene.add(root);
  try {
    const sphere = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
    const radius = sphere.radius * 1.02;
    Object.assign(camera, { left: -radius, right: radius, top: radius, bottom: -radius });
    camera.near = 0.1;
    camera.far = radius * 4;
    camera.position.copy(sphere.center).addScaledVector(VIEW, radius * 2);
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    scene.remove(root);
    // Geometry stays shared with the cached model; only the colored materials are this clone's.
    instance.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose();
    });
  }
}

/** Loads every part requested in the same tick together, then renders them one by one. */
async function flush() {
  flushing = true;
  while (queued.size) {
    const batch = new Map(queued);
    queued.clear();
    const models = await loadLDrawModels([...batch.keys()]).catch(() => null);
    for (const [id, resolve] of batch) {
      let url: string | null = null;
      try {
        if (models) url = render(models[id]);
      } catch {
        // Keep the picker's stud block for this part.
      }
      resolve(url);
      // Yield between renders so scrolling stays responsive.
      await new Promise((done) => setTimeout(done));
    }
  }
  flushing = false;
}

function requestThumbnail(partId: string): Promise<string | null> {
  let thumbnail = thumbnails.get(partId);
  if (!thumbnail) {
    thumbnail = new Promise((resolve) => queued.set(partId, resolve));
    thumbnails.set(partId, thumbnail);
    if (!flushing) setTimeout(flush);
  }
  return thumbnail;
}

/** A rendered image of the part once its tile has scrolled into view, or null until then. */
export function usePartThumbnail(partId: string, element: Element | null): string | null {
  const [thumbnail, setThumbnail] = useState<{ id: string; url: string | null }>();
  useEffect(() => {
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void requestThumbnail(partId).then((url) => {
          if (!cancelled) setThumbnail({ id: partId, url });
        });
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [partId, element]);
  return thumbnail?.id === partId ? thumbnail.url : null;
}
