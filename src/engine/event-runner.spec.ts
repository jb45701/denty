import { describe, expect, it } from 'vitest';
import {
  CHECK_MARGIN,
  CHECK_ROLL_MAX,
  CHECK_ROLL_MIN,
  CHECK_THRESHOLD_MAX,
  CHECK_THRESHOLD_MIN,
  VERIFY_COMPOSURE_COST,
  VERIFY_DRIFT_RELIEF,
} from './constants';
import { createRng } from './rng';
import { addFlag, createInitialState, setDrift, setStat } from './state';
import type { EventChoice, EffectBundle, MemoEvent, StatCheck } from './event-types';
import type { GameState } from './types';
import {
  availableChoices,
  checkThreshold,
  isChoiceAvailable,
  resolveCheck,
  resolveChoice,
  unmetRequirements,
} from './event-runner';

const NO_EFFECTS: EffectBundle = { effects: [], log: [] };

function bundle(
  effects: EffectBundle['effects'],
  log: readonly string[] = [],
): EffectBundle {
  return { effects, log };
}

function choice(overrides: Partial<EventChoice> & Pick<EventChoice, 'id'>): EventChoice {
  return {
    label: `Choice ${overrides.id}`,
    effects: NO_EFFECTS,
    ...overrides,
  };
}

function event(choices: readonly EventChoice[], overrides: Partial<MemoEvent> = {}): MemoEvent {
  return {
    id: 'memo-test',
    title: 'Test memo',
    weekMin: 1,
    weekMax: 12,
    memo: ['Line one.', 'Line two.'],
    choices,
    ...overrides,
  };
}

describe('checkThreshold', () => {
  it('is stat + modifier - difficulty + 50', () => {
    const state = setStat(createInitialState(), 'scrutiny', 40);
    const check: StatCheck = { stat: 'scrutiny', difficulty: 30 };
    expect(checkThreshold(check, state)).toBe(40 - 30 + CHECK_MARGIN);

    const modified: StatCheck = { stat: 'scrutiny', difficulty: 30, modifier: 10 };
    expect(checkThreshold(modified, state)).toBe(40 + 10 - 30 + CHECK_MARGIN);
  });

  it('treats difficulty equal to the stat as a coin flip', () => {
    const state = setStat(createInitialState(), 'scrutiny', 35);
    expect(checkThreshold({ stat: 'scrutiny', difficulty: 35 }, state)).toBe(50);
  });

  it('clamps the target into the 5-95 band', () => {
    const high = setStat(createInitialState(), 'comprehension', 100);
    expect(checkThreshold({ stat: 'comprehension', difficulty: 0 }, high)).toBe(CHECK_THRESHOLD_MAX);

    const low = setStat(createInitialState(), 'comprehension', 0);
    expect(checkThreshold({ stat: 'comprehension', difficulty: 100 }, low)).toBe(CHECK_THRESHOLD_MIN);
  });
});

describe('resolveCheck', () => {
  it('rolls a d100 within 1-100 and passes only when roll <= threshold', () => {
    const state = setStat(createInitialState(), 'scrutiny', 35);
    const check: StatCheck = { stat: 'scrutiny', difficulty: 35 };

    for (let seed = 0; seed < 50; seed++) {
      const result = resolveCheck(check, state, createRng(seed));
      expect(result.roll).toBeGreaterThanOrEqual(CHECK_ROLL_MIN);
      expect(result.roll).toBeLessThanOrEqual(CHECK_ROLL_MAX);
      expect(result.threshold).toBe(50);
      expect(result.success).toBe(result.roll <= result.threshold);
      expect(result.stat).toBe('scrutiny');
      expect(result.difficulty).toBe(35);
    }
  });

  it('reproduces the roll for a fixed seed', () => {
    const state = createInitialState();
    const check: StatCheck = { stat: 'scrutiny', difficulty: 35 };
    const a = resolveCheck(check, state, createRng('seed-fixed'));
    const b = resolveCheck(check, state, createRng('seed-fixed'));
    expect(a).toEqual(b);
  });

  it('produces both pass and fail across seeds (not a fixed outcome)', () => {
    const state = setStat(createInitialState(), 'scrutiny', 35);
    const check: StatCheck = { stat: 'scrutiny', difficulty: 35 };
    const outcomes = new Set<boolean>();
    for (let seed = 0; seed < 100; seed++) {
      outcomes.add(resolveCheck(check, state, createRng(seed)).success);
    }
    expect([...outcomes].sort()).toEqual([false, true]);
  });
});

describe('resolveChoice — effects', () => {
  it('applies stat deltas and clamps at 0 and 100', () => {
    const base = setStat(setStat(createInitialState(), 'mandate', 2), 'composure', 99);
    const e = event([
      choice({
        id: 'a',
        effects: bundle([
          { kind: 'stat', stat: 'mandate', delta: -10 },
          { kind: 'stat', stat: 'composure', delta: 10 },
        ]),
      }),
    ]);

    const res = resolveChoice(base, e, 'a', createRng(1));
    expect(res.state.stats.mandate).toBe(0);
    expect(res.state.stats.composure).toBe(100);
  });

  it('applies faction deltas', () => {
    const e = event([
      choice({
        id: 'a',
        effects: bundle([
          { kind: 'faction', faction: 'acceleration', delta: 7 },
          { kind: 'faction', faction: 'governance', delta: -9 },
        ]),
      }),
    ]);
    const res = resolveChoice(createInitialState(), e, 'a', createRng(1));
    expect(res.state.factions.acceleration).toBe(57);
    expect(res.state.factions.governance).toBe(41);
    expect(res.state.factions.doctrine).toBe(50);
  });

  it('applies Drift deltas and clamps at 0 and 100', () => {
    const e = event([
      choice({
        id: 'up',
        effects: bundle([{ kind: 'drift', delta: 12 }]),
      }),
      choice({
        id: 'down',
        effects: bundle([{ kind: 'drift', delta: -12 }]),
      }),
    ]);

    expect(resolveChoice(createInitialState(), e, 'up', createRng(1)).state.drift).toBe(12);
    expect(resolveChoice(setDrift(createInitialState(), 5), e, 'down', createRng(1)).state.drift).toBe(0);
    expect(resolveChoice(setDrift(createInitialState(), 100), e, 'up', createRng(1)).state.drift).toBe(100);
  });

  it('sets and clears flags', () => {
    const e = event([
      choice({
        id: 'set',
        effects: bundle([
          { kind: 'flag', flag: 'alpha' },
          { kind: 'flag', flag: 'beta', value: true },
        ]),
      }),
      choice({
        id: 'clear',
        effects: bundle([
          { kind: 'flag', flag: 'alpha', value: false },
          { kind: 'flag', flag: 'gamma', value: false },
        ]),
      }),
    ]);

    const set = resolveChoice(createInitialState(), e, 'set', createRng(1)).state;
    expect([...set.flags].sort()).toEqual(['alpha', 'beta']);

    const cleared = resolveChoice(set, e, 'clear', createRng(1)).state;
    expect([...cleared.flags]).toEqual(['beta']);
  });

  it('records ticket spawns with the originating event and choice', () => {
    const e = event([
      choice({
        id: 'dispatch',
        actionCost: 1,
        effects: bundle([
          { kind: 'spawnTicket', unit: 'reviewer', ticketType: 'eval_resample', note: 'independent' },
          { kind: 'spawnTicket', unit: 'ops', ticketType: 'queue_triage' },
        ]),
      }),
    ]);

    const res = resolveChoice(createInitialState(), e, 'dispatch', createRng(1));
    expect(res.tickets).toEqual([
      { eventId: 'memo-test', choiceId: 'dispatch', unit: 'reviewer', ticketType: 'eval_resample', note: 'independent' },
      { eventId: 'memo-test', choiceId: 'dispatch', unit: 'ops', ticketType: 'queue_triage' },
    ]);
    expect(res.actionsSpent).toBe(1);
  });

  it('applies the verify action with canon Drift relief and the default Composure cost', () => {
    const base = setDrift(createInitialState(), 20);
    const e = event([
      choice({
        id: 'verify',
        actionCost: 1,
        effects: bundle([{ kind: 'verify', target: 'ticket-17' }]),
      }),
    ]);

    const res = resolveChoice(base, e, 'verify', createRng(1));
    expect(res.state.drift).toBe(20 - VERIFY_DRIFT_RELIEF);
    expect(res.state.stats.composure).toBe(35 - VERIFY_COMPOSURE_COST);
    expect(res.verifications).toEqual([
      {
        eventId: 'memo-test',
        choiceId: 'verify',
        target: 'ticket-17',
        driftRelief: VERIFY_DRIFT_RELIEF,
        composureCost: VERIFY_COMPOSURE_COST,
      },
    ]);
    expect(res.actionsSpent).toBe(1);
  });

  it('honours per-effect verify overrides and clamps Drift relief at 0', () => {
    const e = event([
      choice({
        id: 'verify',
        effects: bundle([{ kind: 'verify', driftRelief: 30, composureCost: 0 }]),
      }),
    ]);
    const res = resolveChoice(setDrift(createInitialState(), 10), e, 'verify', createRng(1));
    expect(res.state.drift).toBe(0);
    expect(res.state.stats.composure).toBe(35);
    expect(res.verifications[0]?.driftRelief).toBe(30);
  });

  it('does not mutate the input state', () => {
    const base = addFlag(setDrift(createInitialState(), 10), 'existing');
    const snapshot = {
      ...base,
      stats: { ...base.stats },
      factions: { ...base.factions },
      flags: new Set(base.flags),
    };
    const e = event([
      choice({
        id: 'a',
        effects: bundle([
          { kind: 'stat', stat: 'mandate', delta: -5 },
          { kind: 'drift', delta: 5 },
          { kind: 'flag', flag: 'added' },
        ]),
      }),
    ]);

    resolveChoice(base, e, 'a', createRng(1));
    expect(base).toEqual(snapshot);
    expect([...base.flags]).toEqual(['existing']);
  });

  it('concatenates narration: always-on bundle first, then the check branch', () => {
    const e = event([
      choice({
        id: 'a',
        check: { stat: 'scrutiny', difficulty: 100 }, // always fails at clamp 5
        effects: bundle([], ['always']),
        onSuccess: bundle([], ['success-only']),
        onFailure: bundle([], ['failure-only']),
      }),
    ]);
    expect(resolveChoice(createInitialState(), e, 'a', createRng(1)).log).toEqual(['always', 'failure-only']);
  });
});

describe('resolveChoice — checks and branches', () => {
  const checkedEvent = event([
    choice({
      id: 'read',
      actionCost: 1,
      check: { stat: 'scrutiny', difficulty: 35 },
      effects: bundle([{ kind: 'drift', delta: 1 }], ['compare']),
      onSuccess: bundle([{ kind: 'stat', stat: 'comprehension', delta: 4 }], ['the numbers agree']),
      onFailure: bundle([{ kind: 'stat', stat: 'composure', delta: -4 }], ['the numbers disagree']),
    }),
  ]);

  /** First seed in a fixed scan whose d100 lands on the wanted side. */
  function seedWithOutcome(state: GameState, success: boolean): number {
    for (let seed = 0; seed < 1000; seed++) {
      const result = resolveCheck({ stat: 'scrutiny', difficulty: 35 }, state, createRng(seed));
      if (result.success === success) return seed;
    }
    throw new Error(`no seed produced success=${String(success)}`);
  }

  it('applies the success branch when the roll passes', () => {
    const state = setStat(createInitialState(), 'scrutiny', 100); // threshold clamps to 95
    const res = resolveChoice(state, checkedEvent, 'read', createRng(seedWithOutcome(state, true)));
    expect(res.check?.success).toBe(true);
    expect(res.state.stats.comprehension).toBe(39);
    expect(res.state.stats.composure).toBe(35);
    expect(res.state.drift).toBe(1);
    expect(res.log).toEqual(['compare', 'the numbers agree']);
  });

  it('applies the failure branch when the roll fails', () => {
    const state = setStat(createInitialState(), 'scrutiny', 0); // threshold clamps to 5
    const res = resolveChoice(state, checkedEvent, 'read', createRng(seedWithOutcome(state, false)));
    expect(res.check?.success).toBe(false);
    expect(res.state.stats.comprehension).toBe(35);
    expect(res.state.stats.composure).toBe(31);
    expect(res.state.drift).toBe(1);
    expect(res.log).toEqual(['compare', 'the numbers disagree']);
  });

  it('resolves each branch at least once across seeds', () => {
    const state = createInitialState();
    const seen = new Set<boolean>();
    for (let seed = 0; seed < 100; seed++) {
      seen.add(resolveChoice(state, checkedEvent, 'read', createRng(seed)).check?.success ?? false);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });
});

describe('resolveChoice — availability', () => {
  it('spends actions and floors at 0', () => {
    const e = event([choice({ id: 'a', actionCost: 2 })]);
    const res = resolveChoice(createInitialState(), e, 'a', createRng(1));
    expect(res.state.actionsRemaining).toBe(1);
    expect(res.actionsSpent).toBe(2);
  });

  it('throws when the choice costs more actions than remain', () => {
    const e = event([choice({ id: 'a', actionCost: 4 })]);
    expect(() => resolveChoice(createInitialState(), e, 'a', createRng(1))).toThrow(/costs 4 action/);
  });

  it('throws on an unknown choice id', () => {
    const e = event([choice({ id: 'a' })]);
    expect(() => resolveChoice(createInitialState(), e, 'nope', createRng(1))).toThrow(RangeError);
  });

  it('locks stat-gated choices when the stat is too low', () => {
    const e = event([
      choice({
        id: 'guarded',
        requires: [{ kind: 'statAtLeast', stat: 'composure', value: 30 }],
      }),
    ]);
    const low = setStat(createInitialState(), 'composure', 29);
    expect(isChoiceAvailable(low, e.choices[0]!)).toBe(false);
    expect(availableChoices(low, e)).toEqual([]);
    expect(() => resolveChoice(low, e, 'guarded', createRng(1))).toThrow(/locked/);
    expect(isChoiceAvailable(createInitialState(), e.choices[0]!)).toBe(true);
  });

  it('handles flag / noFlag / statAtMost requirements', () => {
    const e = event([
      choice({
        id: 'guarded',
        requires: [
          { kind: 'flag', flag: 'alpha' },
          { kind: 'noFlag', flag: 'beta' },
          { kind: 'statAtMost', stat: 'mandate', value: 40 },
        ],
      }),
    ]);

    expect(unmetRequirements(createInitialState(), e.choices[0]!.requires!)).toEqual([
      'requires flag "alpha"',
    ]);

    const withFlag = addFlag(createInitialState(), 'alpha');
    expect(unmetRequirements(withFlag, e.choices[0]!.requires!)).toEqual([]);

    const withBeta = addFlag(withFlag, 'beta');
    expect(unmetRequirements(withBeta, e.choices[0]!.requires!)).toEqual(['forbids flag "beta"']);

    const highMandate = setStat(withFlag, 'mandate', 60);
    expect(unmetRequirements(highMandate, e.choices[0]!.requires!)).toEqual([
      'requires mandate <= 40',
    ]);
  });

  it('lists only unlocked choices in authored order', () => {
    const e = event([
      choice({ id: 'a' }),
      choice({ id: 'b', actionCost: 2, requires: [{ kind: 'statAtLeast', stat: 'mandate', value: 90 }] }),
      choice({ id: 'c', actionCost: 3 }),
    ]);
    expect(availableChoices(createInitialState(), e).map((c) => c.id)).toEqual(['a', 'c']);
  });
});

describe('resolveChoice — determinism', () => {
  const e = event([
    choice({
      id: 'checked',
      actionCost: 1,
      check: { stat: 'scrutiny', difficulty: 30 },
      effects: bundle([{ kind: 'stat', stat: 'mandate', delta: -2 }], ['a']),
      onSuccess: bundle([{ kind: 'stat', stat: 'comprehension', delta: 3 }], ['b']),
      onFailure: bundle([{ kind: 'drift', delta: 2 }], ['c']),
    }),
    choice({
      id: 'unchecked',
      actionCost: 1,
      effects: bundle([{ kind: 'drift', delta: 3 }], ['plain']),
    }),
  ]);

  it('produces identical results for identically seeded runs', () => {
    const base = setStat(setDrift(createInitialState(), 12), 'scrutiny', 50);
    const a = resolveChoice(base, e, 'checked', createRng('playthrough-4'));
    const b = resolveChoice(base, e, 'checked', createRng('playthrough-4'));
    expect(a).toEqual(b);
    expect(a.check).toEqual(b.check);
  });

  it('does not consume RNG for a check-free choice', () => {
    const rng = createRng('unchecked');
    const before = rng.getState();
    resolveChoice(createInitialState(), e, 'unchecked', rng);
    expect(rng.getState()).toEqual(before);
  });

  it('consumes exactly one draw, leaving the RNG where a standalone check roll would', () => {
    const base = setStat(createInitialState(), 'scrutiny', 50);

    const viaChoice = createRng('position');
    resolveChoice(base, e, 'checked', viaChoice);

    const standalone = createRng('position');
    const roll = standalone.nextInclusive(CHECK_ROLL_MIN, CHECK_ROLL_MAX);
    expect(viaChoice.getState()).toEqual(standalone.getState());
    expect(roll).toBe(resolveChoice(base, e, 'checked', createRng('position')).check?.roll);
  });
});
