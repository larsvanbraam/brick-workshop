import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Path, Shape } from 'three';
import { PLATE_HEIGHT, getPart } from '@lego-builder/brick-engine';
import type { Brick } from '@lego-builder/brick-engine';

export function createFallbackGeometry(brick: Brick) {
  const part = getPart(brick.partId);
  const height = part.height * PLATE_HEIGHT;
  let geometry;
  if (part.shape === 'round' || part.shape === 'cone') {
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
    part.shape === 'slope'
  ) {
    const profile = new Shape();
    const halfSpan = part.depth / 2;
    const halfHeight = height / 2;
    profile.moveTo(-halfSpan, -halfHeight);
    profile.lineTo(halfSpan, -halfHeight);
    profile.lineTo(halfSpan, halfHeight);
    profile.lineTo(-halfSpan, halfHeight);
    profile.closePath();
    if (part.shape === 'slope') {
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
  } else {
    geometry = new BoxGeometry(part.width - 0.035, height - 0.025, part.depth - 0.035);
  }
  geometry.rotateY((brick.rotation * Math.PI) / 180);
  return geometry;
}
