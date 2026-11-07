import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Path, Shape, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATE_HEIGHT, footprint, getPart } from '@lego-builder/brick-engine';
import type { Brick } from '@lego-builder/brick-engine';

export function createFallbackGeometry(brick: Brick) {
  const part = getPart(brick.partId);
  if (brick.facing) {
    // A piece mounted on a side stud: a plain slab is enough until its LDraw model loads.
    const size = footprint(brick);
    return new BoxGeometry(
      size.width - 0.035,
      size.height * PLATE_HEIGHT - 0.025,
      size.depth - 0.035,
    );
  }
  const height = part.height * PLATE_HEIGHT;
  let geometry;
  if (part.shape === 'foliage') {
    const elements = [];
    if (['3470', '3471', '6064'].includes(part.id)) {
      elements.push(
        new CylinderGeometry(0.08, 0.12, height * 0.65, 10).translate(0, -height * 0.175, 0),
      );
      elements.push(
        part.id === '3471'
          ? new CylinderGeometry(0, part.width * 0.43, height * 0.85, 16).translate(
              0,
              height * 0.06,
              0,
            )
          : new SphereGeometry(1, 20, 14)
              .scale(part.width * 0.43, height * 0.38, part.depth * 0.43)
              .translate(0, height * 0.1, 0),
      );
    } else if (part.id === '30093') {
      for (let index = 0; index < 5; index++) {
        const bladeHeight = height * (0.7 + index * 0.05);
        elements.push(
          new CylinderGeometry(0.012, 0.1, bladeHeight, 6).translate(
            (index - 2) * part.width * 0.13,
            (bladeHeight - height) / 2,
            0,
          ),
        );
      }
    } else {
      for (const [horizontal, depth] of [
        [-0.2, -0.15],
        [0.2, -0.15],
        [0, 0.2],
      ])
        elements.push(
          new SphereGeometry(1, 16, 10)
            .scale(part.width * 0.27, height * 0.4, part.depth * 0.27)
            .translate(horizontal * part.width, 0, depth * part.depth),
        );
    }
    geometry = mergeGeometries(elements)!;
    for (const element of elements) element.dispose();
  } else if (part.shape === 'detail' && ['3185', '3633', '33303', '30055'].includes(part.id)) {
    const elements = [
      new BoxGeometry(part.width * 0.25, 0.12, part.depth).translate(0, -height / 2 + 0.06, 0),
    ];
    for (let index = 0; index < part.depth * 2; index++)
      elements.push(
        new BoxGeometry(part.width * 0.25, height, 0.1).translate(
          0,
          0,
          -part.depth / 2 + 0.15 + (index * (part.depth - 0.3)) / (part.depth * 2 - 1),
        ),
      );
    if (part.id !== '33303')
      elements.push(
        new BoxGeometry(part.width * 0.25, 0.12, part.depth).translate(0, height / 2 - 0.06, 0),
      );
    geometry = mergeGeometries(elements)!;
    for (const element of elements) element.dispose();
  } else if (part.shape === 'round' || part.shape === 'cone' || part.id === '18674') {
    const topWidth = Math.sqrt(part.connections.topStuds.length || 1);
    geometry = new CylinderGeometry(
      part.shape === 'cone'
        ? Math.min(part.width / 2 - 0.0175, topWidth === 1 ? 0.4 : 1.15)
        : part.width / 2 - 0.0175,
      part.width / 2 - 0.0175,
      height - 0.025,
      48,
    );
  } else if (
    part.shape === 'arch' ||
    part.shape === 'window' ||
    part.shape === 'door' ||
    part.shape === 'slope' ||
    part.shape === 'inverted-slope'
  ) {
    const profile = new Shape();
    const halfSpan = part.depth / 2;
    const halfHeight = height / 2;
    profile.moveTo(-halfSpan, -halfHeight);
    profile.lineTo(halfSpan, -halfHeight);
    profile.lineTo(halfSpan, halfHeight);
    profile.lineTo(-halfSpan, halfHeight);
    profile.closePath();
    if (part.shape === 'slope' || part.shape === 'inverted-slope') {
      profile.curves.length = 0;
      profile.moveTo(-halfSpan, -halfHeight);
      profile.lineTo(halfSpan, -halfHeight);
      profile.lineTo(halfSpan, halfHeight);
      profile.lineTo(halfSpan - 1, halfHeight);
      profile.lineTo(-halfSpan, -halfHeight + height / 6);
      profile.closePath();
    } else if (part.shape === 'arch') {
      profile.curves.length = 0;
      profile.moveTo(-halfSpan, -halfHeight);
      profile.lineTo(-halfSpan, halfHeight);
      profile.lineTo(halfSpan, halfHeight);
      profile.lineTo(halfSpan, -halfHeight);
      profile.lineTo(halfSpan - 1, -halfHeight);
      profile.lineTo(halfSpan - 1, halfHeight - 0.9);
      profile.quadraticCurveTo(0, halfHeight + 0.1, -halfSpan + 1, halfHeight - 0.9);
      profile.lineTo(-halfSpan + 1, -halfHeight);
      profile.closePath();
    } else if (part.shape === 'window' || ['3579', '60596'].includes(part.id)) {
      const border = part.shape === 'window' ? 0.22 : 0.3;
      const opening = new Path();
      opening.moveTo(-halfSpan + border, -halfHeight + border);
      opening.lineTo(-halfSpan + border, halfHeight - border);
      opening.lineTo(halfSpan - border, halfHeight - border);
      opening.lineTo(halfSpan - border, -halfHeight + border);
      opening.closePath();
      profile.holes.push(opening);
    }
    geometry = new ExtrudeGeometry(profile, {
      depth: part.width,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 24,
    });
    geometry.translate(0, 0, -part.width / 2);
    geometry.rotateY(-Math.PI / 2);
    if (part.shape === 'inverted-slope') geometry.rotateZ(Math.PI);
  } else {
    geometry = new BoxGeometry(part.width - 0.035, height - 0.025, part.depth - 0.035);
  }
  geometry.rotateY((brick.rotation * Math.PI) / 180);
  return geometry;
}
