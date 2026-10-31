import { Group, InstancedMesh, LineSegments, Matrix3, Matrix4, Mesh, Vector3 } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATE_HEIGHT, getLDrawTransform, getPart } from '@lego-builder/brick-engine';
import type { Brick } from '@lego-builder/brick-engine';
import type { BufferAttribute, Material } from 'three';

Mesh.prototype.raycast = acceleratedRaycast;

export function canBatchLDrawModel(model: Group): boolean {
  model.updateMatrixWorld(true);
  let faces = false;
  let supported = true;
  model.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    if (object instanceof Mesh) faces = true;
    if (
      object.matrixWorld.determinant() < 0 ||
      (Array.isArray(object.material) ? object.material : [object.material]).some(
        (material) => material.transparent,
      )
    )
      supported = false;
  });
  return faces && supported;
}

export function createLDrawBatch(
  bricks: readonly Brick[],
  model: Group,
  buildArea: number,
  explode = false,
): Group {
  const result = new Group();
  result.name = 'Native brick batch';
  result.scale.set(0.05, -0.05, 0.05);
  model.updateMatrixWorld(true);
  const transforms = bricks.map((brick) => {
    const transform = getLDrawTransform(brick);
    return new Matrix4()
      .makeRotationY((transform.rotation * Math.PI) / 180)
      .setPosition(
        transform.x - buildArea * 10,
        -(brick.y + getPart(brick.partId).height) * PLATE_HEIGHT * 20 -
          (explode ? brick.y * 0.18 * 20 : 0),
        transform.z - buildArea * 10,
      );
  });
  model.traverse((object) => {
    if (object instanceof Mesh) {
      const options = { indirect: true, maxLeafTris: 10 };
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      object.geometry.boundsTree ??= new MeshBVH(object.geometry, options);
      const instances = new InstancedMesh(object.geometry, object.material, bricks.length);
      for (const [index, transform] of transforms.entries())
        instances.setMatrixAt(index, transform.clone().multiply(object.matrixWorld));
      instances.instanceMatrix.needsUpdate = true;
      instances.userData.brickIds = bricks.map((brick) => brick.id);
      instances.castShadow = true;
      instances.receiveShadow = true;
      instances.computeBoundingBox();
      instances.computeBoundingSphere();
      result.add(instances);
    } else if (object instanceof LineSegments) {
      const geometries = transforms.map((transform) => {
        const matrix = transform.clone().multiply(object.matrixWorld);
        const geometry = object.geometry.clone().applyMatrix4(matrix);
        for (const name of ['control0', 'control1', 'direction']) {
          const attribute = geometry.getAttribute(name) as BufferAttribute | undefined;
          if (!attribute) continue;
          const linear = new Matrix3().setFromMatrix4(matrix);
          const point = new Vector3();
          for (let index = 0; index < attribute.count; index++) {
            point.fromBufferAttribute(attribute, index);
            if (name === 'direction') point.applyMatrix3(linear);
            else point.applyMatrix4(matrix);
            attribute.setXYZ(index, point.x, point.y, point.z);
          }
        }
        return geometry;
      });
      const merged = mergeGeometries(geometries, false);
      if (!merged) throw new Error('Incompatible LDraw edge attributes.');
      let offset = 0;
      for (const geometry of geometries) {
        for (const group of geometry.groups) {
          const previous = merged.groups.at(-1);
          if (
            previous &&
            previous.materialIndex === group.materialIndex &&
            previous.start + previous.count === offset + group.start
          )
            previous.count += group.count;
          else merged.addGroup(offset + group.start, group.count, group.materialIndex);
        }
        offset += geometry.index?.count ?? geometry.getAttribute('position').count;
        geometry.dispose();
      }
      const lines = new LineSegments(merged, object.material);
      lines.raycast = () => {};
      result.add(lines);
    }
  });
  return result;
}

export function disposeLDrawBatch(batch: Group) {
  const materials = new Set<Material>();
  batch.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
    if (object instanceof InstancedMesh) object.dispose();
    else if (object instanceof LineSegments) object.geometry.dispose();
  });
  for (const material of materials) material.dispose();
}
