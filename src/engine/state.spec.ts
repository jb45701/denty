import { describe, expect, it } from 'vitest';
import {
  ACTIONS_PER_WEEK,
  DRIFT_MAX,
  FACTION_START,
  STAT_MAX,
  STAT_START,
  WEEK_MAX,
} from './constants';
import {
  addFlag,
  addFlags,
  adjustDrift,
  adjustFaction,
  adjustLaunchReadiness,
  adjustStat,
  advanceWeek,
  clamp,
  createInitialState,
  hasActions,
  hasFlag,
  isFinalWeek,
  normalize,
  removeFlag,
  setDrift,
  setFaction,
  setLaunchReadiness,
  setStat,
  spendAction,
} from './state';

describe('createInitialState', () => {
  it('matches the frozen starting values', () => {
    const s = createInitialState();
    expect(s.stats).toEqual({
      mandate: STAT_START,
      comprehension: STAT_START,
      scrutiny: STAT_START,
      composure: STAT_START,
    });
    expect(s.factions).toEqual({
      acceleration: FACTION_START,
      governance: FACTION_START,
      doctrine: FACTION_START,
    });
    expect(s.drift).toBe(0);
    expect(s.week).toBe(1);
    expect(s.actionsRemaining).toBe(ACTIONS_PER_WEEK);
    expect(s.launchReadiness).toBe(0);
    expect([...s.flags]).toEqual([]);
  });

  it('returns a fresh state each call (no shared mutable references)', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a.flags).not.toBe(b.flags);
    expect(a.stats).not.toBe(b.stats);
  });
});

describe('clamp', () => {
  it('bounds a value into the inclusive range', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it('rejects non-finite input rather than corrupting state', () => {
    expect(() => clamp(Number.NaN, 0, 100)).toThrow(TypeError);
    expect(() => clamp(Number.POSITIVE_INFINITY, 0, 100)).toThrow(TypeError);
    expect(() => clamp(Number.NEGATIVE_INFINITY, 0, 100)).toThrow(TypeError);
  });
});

describe('stat transitions', () => {
  it('clamps at the ceiling (100)', () => {
    expect(adjustStat(createInitialState(), 'mandate', 1000).stats.mandate).toBe(STAT_MAX);
  });

  it('clamps at the floor (0) — stats never go negative', () => {
    expect(adjustStat(createInitialState(), 'composure', -1000).stats.composure).toBe(0);
  });

  it('setStat clamps an absolute value at both ends', () => {
    expect(setStat(createInitialState(), 'scrutiny', 250).stats.scrutiny).toBe(STAT_MAX);
    expect(setStat(createInitialState(), 'scrutiny', -1).stats.scrutiny).toBe(0);
    expect(setStat(createInitialState(), 'scrutiny', 61).stats.scrutiny).toBe(61);
  });

  it('adjusts only the named stat', () => {
    const s = adjustStat(createInitialState(), 'mandate', -10);
    expect(s.stats.mandate).toBe(25);
    expect(s.stats.comprehension).toBe(STAT_START);
    expect(s.stats.scrutiny).toBe(STAT_START);
    expect(s.stats.composure).toBe(STAT_START);
  });

  it('is pure — the input state is never mutated', () => {
    const before = createInitialState();
    const after = adjustStat(before, 'mandate', -10);
    expect(before.stats.mandate).toBe(STAT_START);
    expect(after).not.toBe(before);
    expect(after.stats).not.toBe(before.stats);
  });
});

describe('faction standing', () => {
  it('starts at 50 and clamps to 0..100', () => {
    const s = createInitialState();
    expect(s.factions.acceleration).toBe(FACTION_START);
    expect(adjustFaction(s, 'governance', 100).factions.governance).toBe(100);
    expect(adjustFaction(s, 'doctrine', -100).factions.doctrine).toBe(0);
    expect(setFaction(s, 'acceleration', 999).factions.acceleration).toBe(100);
  });

  it('keeps the other factions untouched', () => {
    const s = adjustFaction(createInitialState(), 'doctrine', 20);
    expect(s.factions.doctrine).toBe(70);
    expect(s.factions.acceleration).toBe(FACTION_START);
    expect(s.factions.governance).toBe(FACTION_START);
  });
});

describe('drift', () => {
  it('starts at 0 and clamps to 0..100', () => {
    const s = createInitialState();
    expect(adjustDrift(s, -50).drift).toBe(0);
    expect(adjustDrift(s, 1000).drift).toBe(DRIFT_MAX);
    expect(adjustDrift(s, 12).drift).toBe(12);
    expect(setDrift(s, -1).drift).toBe(0);
  });
});

describe('launch readiness', () => {
  it('starts at 0 and clamps to 0..100', () => {
    const s = createInitialState();
    expect(setLaunchReadiness(s, 150).launchReadiness).toBe(100);
    expect(setLaunchReadiness(s, -20).launchReadiness).toBe(0);
    expect(adjustLaunchReadiness(s, 42).launchReadiness).toBe(42);
  });
});

describe('flags', () => {
  it('adds, checks and removes without mutating the source', () => {
    const s0 = createInitialState();
    const s1 = addFlag(s0, 'cut_logging');
    expect(hasFlag(s1, 'cut_logging')).toBe(true);
    expect(hasFlag(s0, 'cut_logging')).toBe(false);
    expect([...s0.flags]).toHaveLength(0);
    expect([...s1.flags]).toEqual(['cut_logging']);

    const s2 = removeFlag(s1, 'cut_logging');
    expect(hasFlag(s2, 'cut_logging')).toBe(false);
    expect(hasFlag(s1, 'cut_logging')).toBe(true);
  });

  it('adding an existing flag or removing an absent one is a no-op', () => {
    const s1 = addFlag(createInitialState(), 'burned_reviewer');
    expect(addFlag(s1, 'burned_reviewer')).toBe(s1);
    expect(removeFlag(s1, 'never_set')).toBe(s1);
  });

  it('addFlags applies several flags in one pass', () => {
    const s = addFlags(createInitialState(), ['ignored_evals', 'cut_logging']);
    expect([...s.flags].sort()).toEqual(['cut_logging', 'ignored_evals']);
  });
});

describe('actions', () => {
  it('spends down and floors at zero (never negative)', () => {
    let s = createInitialState();
    expect(s.actionsRemaining).toBe(ACTIONS_PER_WEEK);
    s = spendAction(s);
    expect(s.actionsRemaining).toBe(2);
    s = spendAction(s, 5);
    expect(s.actionsRemaining).toBe(0);
    expect(hasActions(s)).toBe(false);
  });

  it('hasActions gates on the remaining count', () => {
    let s = createInitialState();
    expect(hasActions(s, 3)).toBe(true);
    expect(hasActions(s, 4)).toBe(false);
    s = spendAction(s, 1);
    expect(hasActions(s, 2)).toBe(true);
    expect(hasActions(s, 3)).toBe(false);
  });

  it('rejects a negative or fractional spend', () => {
    expect(() => spendAction(createInitialState(), -1)).toThrow(RangeError);
    expect(() => spendAction(createInitialState(), 1.5)).toThrow(RangeError);
  });
});

describe('calendar', () => {
  it('advances the week and refills the action pool', () => {
    let s = spendAction(createInitialState(), 3);
    expect(s.actionsRemaining).toBe(0);
    s = advanceWeek(s);
    expect(s.week).toBe(2);
    expect(s.actionsRemaining).toBe(ACTIONS_PER_WEEK);
  });

  it('never advances past week 12 (the launch week)', () => {
    let s = createInitialState();
    for (let i = 0; i < 20; i++) s = advanceWeek(s);
    expect(s.week).toBe(WEEK_MAX);
    expect(isFinalWeek(s)).toBe(true);
  });

  it('advancing on the final week is a no-op', () => {
    let s = createInitialState();
    while (!isFinalWeek(s)) s = advanceWeek(s);
    expect(advanceWeek(s)).toBe(s);
  });
});

describe('normalize', () => {
  it('repairs out-of-range and non-integer fields into valid state', () => {
    const broken = {
      ...createInitialState(),
      stats: { mandate: 999, comprehension: -3, scrutiny: 40, composure: 40 },
      factions: { acceleration: 500, governance: -1, doctrine: 50 },
      drift: 250,
      week: 99,
      actionsRemaining: -4,
      launchReadiness: 150,
    };
    const fixed = normalize(broken);
    expect(fixed.stats.mandate).toBe(100);
    expect(fixed.stats.comprehension).toBe(0);
    expect(fixed.stats.scrutiny).toBe(40);
    expect(fixed.factions.acceleration).toBe(100);
    expect(fixed.factions.governance).toBe(0);
    expect(fixed.drift).toBe(100);
    expect(fixed.week).toBe(WEEK_MAX);
    expect(fixed.actionsRemaining).toBe(0);
    expect(fixed.launchReadiness).toBe(100);
  });

  it('truncates fractional week/action values and clones flags', () => {
    const source = createInitialState();
    const fixed = normalize({ ...source, week: 3.9, actionsRemaining: 2.7 });
    expect(fixed.week).toBe(3);
    expect(fixed.actionsRemaining).toBe(2);
    expect(fixed.flags).not.toBe(source.flags);
  });

  it('is idempotent on an already-valid state', () => {
    const valid = createInitialState();
    const once = normalize(valid);
    const twice = normalize(once);
    expect(twice).toEqual(once);
  });
});
