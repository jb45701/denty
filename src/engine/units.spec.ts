import { describe, expect, it } from 'vitest';
import { UNIT_NAMES } from './event-types';
import { allUnitSpecs, UNIT_SPECS, unitSpec } from './units';

describe('units', () => {
  it('defines exactly the three cells the scope lock names', () => {
    expect(Object.keys(UNIT_SPECS).sort()).toEqual([...UNIT_NAMES].sort());
    expect(allUnitSpecs().map((spec) => spec.unit)).toEqual([...UNIT_NAMES]);
  });

  it('keeps every spec self-consistent and playable', () => {
    for (const spec of allUnitSpecs()) {
      expect(spec.unit).toBe(spec.unit.toLowerCase());
      expect(spec.cell.length).toBeGreaterThan(0);
      expect(Number.isInteger(spec.ackLatency)).toBe(true);
      expect(spec.ackLatency).toBeGreaterThanOrEqual(1);
      expect(spec.ackReliability).toBeGreaterThan(0);
      expect(spec.ackReliability).toBeLessThanOrEqual(1);
      expect(spec.reportReliability).toBeGreaterThan(0);
      expect(spec.reportReliability).toBeLessThanOrEqual(1);
      expect(Number.isFinite(spec.verdictBias)).toBe(true);
      expect(Math.abs(spec.verdictBias)).toBeLessThan(0.5);
    }
  });

  it('looks a spec up by unit name', () => {
    expect(unitSpec('coder')).toBe(UNIT_SPECS.coder);
    expect(unitSpec('reviewer').cell).toBe('Reviewer cell');
    expect(unitSpec('ops').ackLatency).toBe(2);
  });

  it('makes the cells a real trade, not a reskin', () => {
    // ops answers slowest; coder answers fastest.
    expect(UNIT_SPECS.ops.ackLatency).toBeGreaterThan(UNIT_SPECS.coder.ackLatency);
    // the reviewer cell files the most defensible work and reviews its own.
    expect(UNIT_SPECS.reviewer.reportReliability).toBeGreaterThan(
      UNIT_SPECS.coder.reportReliability,
    );
    expect(UNIT_SPECS.reviewer.verdictBias).toBeGreaterThan(UNIT_SPECS.ops.verdictBias);
    // no two cells share the same reliability profile.
    const signatures = new Set(
      allUnitSpecs().map((spec) => `${spec.ackLatency}/${spec.ackReliability}/${spec.reportReliability}`),
    );
    expect(signatures.size).toBe(UNIT_NAMES.length);
  });
});
