import { describe, expect, it } from 'vitest';
import type { EffectBundle, EventChoice, MemoEvent } from './event-types';
import { validateEvent, validateEventPool } from './event-validation';

const NO_EFFECTS: EffectBundle = { effects: [], log: [] };

function choice(id: string, overrides: Partial<EventChoice> = {}): EventChoice {
  return { id, label: `Choice ${id}`, effects: NO_EFFECTS, ...overrides };
}

function memo(overrides: Partial<MemoEvent> = {}): MemoEvent {
  return {
    id: 'valid-memo',
    title: 'Valid memo',
    weekMin: 1,
    weekMax: 12,
    memo: ['Line one.', 'Line two.'],
    choices: [choice('a'), choice('b'), choice('c')],
    ...overrides,
  };
}

describe('validateEvent', () => {
  it('accepts a well-formed event', () => {
    expect(() => validateEvent(memo())).not.toThrow();
  });

  it('accepts a full four-choice event with a checked choice', () => {
    expect(() =>
      validateEvent(
        memo({
          choices: [
            choice('a'),
            choice('b'),
            choice('c'),
            choice('d', {
              actionCost: 1,
              check: { stat: 'scrutiny', difficulty: 35 },
              onSuccess: { effects: [{ kind: 'drift', delta: -8 }], log: ['ok'] },
              onFailure: { effects: [{ kind: 'drift', delta: 2 }], log: ['no'] },
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects an empty title or id', () => {
    expect(() => validateEvent(memo({ id: '  ' }))).toThrow(/event id/);
    expect(() => validateEvent(memo({ title: '' }))).toThrow(/title/);
  });

  it('rejects a week range outside the 12-week calendar', () => {
    expect(() => validateEvent(memo({ weekMin: 0 }))).toThrow(/weekMin/);
    expect(() => validateEvent(memo({ weekMax: 13 }))).toThrow(/weekMax/);
    expect(() => validateEvent(memo({ weekMin: 5, weekMax: 4 }))).toThrow(/weekMin must be <= weekMax/);
    expect(() => validateEvent(memo({ weekMin: 1.5 }))).toThrow(/integer/);
  });

  it('rejects a memo body that is not 2-4 lines', () => {
    expect(() => validateEvent(memo({ memo: ['Only one line.'] }))).toThrow(/2-4 lines/);
    expect(() =>
      validateEvent(memo({ memo: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'] })),
    ).toThrow(/2-4 lines/);
    expect(() => validateEvent(memo({ memo: ['One.', '  '] }))).toThrow(/memo line 1/);
  });

  it('rejects a choice count outside 3-4', () => {
    expect(() => validateEvent(memo({ choices: [choice('a'), choice('b')] }))).toThrow(/3-4 choices/);
    expect(() =>
      validateEvent(memo({ choices: [choice('a'), choice('b'), choice('c'), choice('d'), choice('e')] })),
    ).toThrow(/3-4 choices/);
  });

  it('rejects duplicate choice ids', () => {
    expect(() =>
      validateEvent(memo({ choices: [choice('dup'), choice('dup'), choice('c')] })),
    ).toThrow(/duplicate choice id "dup"/);
  });

  it('rejects a check without both branches, and branches without a check', () => {
    expect(() =>
      validateEvent(
        memo({
          choices: [
            choice('a'),
            choice('b'),
            choice('c', {
              check: { stat: 'scrutiny', difficulty: 30 },
              onSuccess: { effects: [], log: [] },
            }),
          ],
        }),
      ),
    ).toThrow(/missing onSuccess\/onFailure/);

    expect(() =>
      validateEvent(
        memo({
          choices: [
            choice('a'),
            choice('b'),
            choice('c', { onFailure: { effects: [], log: [] } }),
          ],
        }),
      ),
    ).toThrow(/no check to resolve them/);
  });

  it('rejects a check with a difficulty off the 0-100 scale', () => {
    expect(() =>
      validateEvent(
        memo({
          choices: [
            choice('a'),
            choice('b'),
            choice('c', {
              check: { stat: 'scrutiny', difficulty: 200 },
              onSuccess: { effects: [], log: [] },
              onFailure: { effects: [], log: [] },
            }),
          ],
        }),
      ),
    ).toThrow(/difficulty must be within 0-100/);
  });

  it('rejects malformed effects', () => {
    const withEffect = (effects: EffectBundle['effects']): MemoEvent =>
      memo({
        choices: [choice('a'), choice('b'), choice('c', { effects: { effects, log: [] } })],
      });

    expect(() =>
      validateEvent(withEffect([{ kind: 'stat', stat: 'mandate', delta: Number.NaN }])),
    ).toThrow(/delta must be finite/);
    expect(() =>
      validateEvent(withEffect([{ kind: 'stat', stat: 'grit' as never, delta: 1 }])),
    ).toThrow(/unknown stat/);
    expect(() =>
      validateEvent(withEffect([{ kind: 'faction', faction: 'safety' as never, delta: 1 }])),
    ).toThrow(/unknown faction/);
    expect(() => validateEvent(withEffect([{ kind: 'flag', flag: '' }]))).toThrow(/flag/);
    expect(() =>
      validateEvent(withEffect([{ kind: 'spawnTicket', unit: 'intern' as never, ticketType: 'x' }])),
    ).toThrow(/unknown unit/);
    expect(() =>
      validateEvent(withEffect([{ kind: 'spawnTicket', unit: 'ops', ticketType: '' }])),
    ).toThrow(/ticketType/);
    expect(() => validateEvent(withEffect([{ kind: 'verify', driftRelief: -1 }]))).toThrow(
      /driftRelief/,
    );
  });

  it('rejects a negative action cost', () => {
    expect(() =>
      validateEvent(memo({ choices: [choice('a', { actionCost: -1 }), choice('b'), choice('c')] })),
    ).toThrow(/actionCost must be >= 0/);
  });
});

describe('validateEventPool', () => {
  it('accepts a pool of distinct valid events', () => {
    expect(() =>
      validateEventPool([memo({ id: 'one' }), memo({ id: 'two' })]),
    ).not.toThrow();
  });

  it('rejects an empty pool', () => {
    expect(() => validateEventPool([])).toThrow(/must not be empty/);
  });

  it('rejects duplicate event ids', () => {
    expect(() => validateEventPool([memo({ id: 'same' }), memo({ id: 'same' })])).toThrow(
      /duplicate event id "same"/,
    );
  });

  it('reports the first malformed event it meets', () => {
    expect(() =>
      validateEventPool([memo({ id: 'one' }), memo({ id: 'broken', choices: [] })]),
    ).toThrow(/invalid memo event/);
  });
});
