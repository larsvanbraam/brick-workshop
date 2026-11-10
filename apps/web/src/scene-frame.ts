import { Box3, Sphere, Vector3 } from 'three';
import { BUILD_AREA, PLATE_HEIGHT, footprint, getLDrawTransform } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';

export function getSceneHeight(assembly: Assembly, explode = false) {
  return Math.max(
    4,
    ...assembly.bricks.map(
      (brick) =>
        (brick.y + footprint(brick).height) * PLATE_HEIGHT + (explode ? brick.y * 0.18 : 0) + 0.17,
    ),
  );
}

/** How far back the camera starts, as a multiple of the distance that just fits the board. */
const FRAME_MARGIN = 1.12;
/** How far back zooming may go: a little past the starting view, and never out of sight. */
const MAX_ZOOM_OUT = 1.8;

/** The distance at which the whole board, up to `height`, just fits the view. */
function fitDistance(height: number, aspect: number, fov: number, buildArea: number) {
  const bounds = new Box3(
    new Vector3(-buildArea / 2, 0, -buildArea / 2),
    new Vector3(buildArea / 2, height, buildArea / 2),
  );
  const radius = bounds.getBoundingSphere(new Sphere()).radius;
  const vertical = (fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return radius / Math.sin(Math.min(vertical, horizontal));
}

/** The farthest the camera may pull back from its target. */
export function getMaxZoomDistance(buildArea: number, height: number, aspect: number, fov = 38) {
  return fitDistance(height, aspect, fov, buildArea) * MAX_ZOOM_OUT;
}

export function getSceneFrame(
  height: number,
  view: 'perspective' | 'top' | 'front',
  aspect: number,
  fov = 38,
  buildArea = BUILD_AREA,
) {
  const bounds = new Box3(
    new Vector3(-buildArea / 2, 0, -buildArea / 2),
    new Vector3(buildArea / 2, height, buildArea / 2),
  );
  const sphere = bounds.getBoundingSphere(new Sphere());
  const distance = fitDistance(height, aspect, fov, buildArea) * FRAME_MARGIN;
  const direction =
    view === 'top'
      ? new Vector3(0, 1, 0.001)
      : view === 'front'
        ? new Vector3(0, 0.08, -1)
        : new Vector3(0.65, 0.5, -0.8);
  return {
    target: sphere.center.toArray(),
    position: direction.normalize().multiplyScalar(distance).add(sphere.center).toArray(),
  };
}

/** A low three-quarter view that fills the frame with the model itself rather than the board. */
export function getCinematicFrame(bounds: Box3, aspect: number, fov = 38) {
  const sphere = bounds.getBoundingSphere(new Sphere());
  const vertical = (fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = (Math.max(sphere.radius, 2) / Math.sin(Math.min(vertical, horizontal))) * 1.02;
  const direction = new Vector3(0.72, 0.3, -0.78);
  return {
    target: sphere.center.toArray(),
    position: direction.normalize().multiplyScalar(distance).add(sphere.center).toArray(),
  };
}

export function getLDrawModelOffset(brick: Brick): [number, number, number] {
  const size = footprint(brick);
  const transform = getLDrawTransform(brick);
  return [
    transform.x / 20 - brick.x - size.width / 2,
    -transform.y / 20 - brick.y * PLATE_HEIGHT,
    transform.z / 20 - brick.z - size.depth / 2,
  ];
}
