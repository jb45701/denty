import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, Rng, type RngState } from './rng';

describe('determinism', () => {
  it('the same seed produces the same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('string seeds are stable and order-sensitive', () => {
    expect(hashSeed('the-release')).toBe(hashSeed('the-release'));
    expect(hashSeed('the-release')).not.toBe(hashSeed('release-the'));
    const a = createRng('the-release');
    const b = createRng('the-release');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('rejects a non-finite numeric seed', () => {
    expect(() => createRng(Number.NaN)).toThrow(TypeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('ranges', () => {
  it('next() stays in [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 2000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt stays in [min, max) and can reach every value', () => {
    const rng = createRng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.nextInt(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('nextInt rejects degenerate ranges and non-integer bounds', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(5, 5)).toThrow(RangeError);
    expect(() => rng.nextInt(6, 5)).toThrow(RangeError);
    expect(() => rng.nextInt(0.5, 3)).toThrow(TypeError);
  });

  it('nextInclusive covers both ends of the range', () => {
    const rng = createRng('incl');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.nextInclusive(1, 3));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

describe('chance', () => {
  it('p <= 0 is always false and p >= 1 is always true', () => {
    const rng = createRng('c');
    for (let i = 0; i < 50; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(-3)).toBe(false);
      expect(rng.chance(1)).toBe(true);
      expect(rng.chance(7)).toBe(true);
    }
  });

  it('rejects a non-finite probability', () => {
    expect(() => createRng(1).chance(Number.NaN)).toThrow(TypeError);
  });
});

describe('pick and shuffle', () => {
  it('pick is deterministic under a fixed seed', () => {
    const a = createRng('pick');
    const b = createRng('pick');
    const items = ['memo-a', 'memo-b', 'memo-c'] as const;
    const seqA = Array.from({ length: 12 }, () => a.pick(items));
    const seqB = Array.from({ length: 12 }, () => b.pick(items));
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => items.includes(v))).toBe(true);
  });

  it('pick rejects an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });

  it('shuffle is a deterministic permutation that never mutates the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = createRng('shuffle').shuffle(input);
    const b = createRng('shuffle').shuffle(input);
    expect(a).toEqual(b);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...a].sort((x, y) => x - y)).toEqual(input);
  });
});

describe('save and restore', () => {
  it('restoring a snapshot continues the identical sequence', () => {
    const original = createRng('save-load');
    for (let i = 0; i < 5; i++) original.next();
    const saved = original.getState();
    const expected = [original.next(), original.next(), original.next()];

    const restored = Rng.fromState(saved);
    expect([restored.next(), restored.next(), restored.next()]).toEqual(expected);
    expect(restored.getState()).toEqual(original.getState());
  });

  it('getState round-trips through JSON', () => {
    const rng = createRng('json');
    rng.next();
    const snapshot = rng.getState();
    const revived = Rng.fromState(JSON.parse(JSON.stringify(snapshot)) as RngState);
    expect(revived.next()).toBe(rng.next());
  });

  it('a restored rng cast to a uint32 stays deterministic for extreme snapshots', () => {
    const revived = Rng.fromState({ algorithm: 'mulberry32', state: 0xffffffff });
    expect(revived.getState().state).toBe(0xffffffff);
    const first = revived.next();
    expect(revived.next()).not.toBe(first);
  });

  it('rejects an unknown algorithm', () => {
    const bad = { algorithm: 'nope' as 'mulberry32', state: 1 };
    expect(() => Rng.fromState(bad)).toThrow(TypeError);
  });
});
