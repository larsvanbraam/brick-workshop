import { describe, expect, it } from 'vite-plus/test';
import { PARTS } from '@brick-workshop/engine';
import { MINIFIG_PARTS } from '@brick-workshop/render/minifig-parts';
import { VEHICLE_PARTS } from '@brick-workshop/render/vehicle-parts';
import { MODELS, modelParts } from './models';
import { VEHICLES } from './vehicle';

describe('vehicle models', () => {
  it('has a model for every vehicle', () => {
    expect(Object.keys(MODELS).sort()).toEqual(Object.keys(VEHICLES).sort());
    for (const [kind, model] of Object.entries(MODELS)) expect(model.kind).toBe(kind);
  });

  it('builds only from parts the library ships', () => {
    const shipped = new Set([...PARTS.map((part) => part.id), ...MINIFIG_PARTS, ...VEHICLE_PARTS]);
    for (const model of Object.values(MODELS))
      for (const part of modelParts(model))
        expect(shipped, `${model.kind}: ${part}`).toContain(part);
  });

  it('ships no vehicle part that no model uses', () => {
    const used = new Set(Object.values(MODELS).flatMap(modelParts));
    for (const part of VEHICLE_PARTS) expect(used, part).toContain(part);
  });

  it('stands every model on its wheels: nothing reaches below the ground', () => {
    for (const model of Object.values(MODELS)) {
      // LDraw's y points down, so the ground is y 0 and every part's origin is above it.
      for (const placement of model.body)
        expect(placement.at[1], model.kind).toBeLessThanOrEqual(0);
      for (const moving of model.moving) expect(moving.pivot[1], model.kind).toBeLessThan(0);
    }
  });
});
