import { describe, expect, it } from 'vitest';
import { MEMOS_PER_WEEK_MAX } from './constants';
import { createRng } from './rng';
import { addFlag, advanceWeek, createInitialState, setDrift, setStat } from './state';
import type { EffectBundle, EventChoice, MemoEvent } from './event-types';
import {
  NO_EVENTS_SEEN,
  drawWeekEvents,
  eligibleEvents,
  isEventEligible,
} from './event-pool';

const NO_EFFECTS: EffectBundle = { effects: [], log: [] };

function choice(id: string): EventChoice {
  return { id, label: `Choice ${id}`, effects: NO_EFFECTS };
}

function memo(id: string, weekMin: number, weekMax: number, overrides: Partial<MemoEvent> = {}): MemoEvent {
  return {
    id,
    title: `Memo ${id}`,
    weekMin,
    weekMax,
    memo: ['Line one.', 'Line two.'],
    choices: [choice('a'), choice('b'), choice('c')],
    ...overrides,
  };
}

const pool: readonly MemoEvent[] = [
  memo('w1', 1, 2),
  memo('w2', 1, 3),
  memo('w3', 2, 4),
  memo('flaggy', 1, 12, { requires: ['alpha'] }),
  memo('no-flaggy', 1, 12, { forbids: ['alpha'] }),
  memo('late', 10, 12),
];

describe('isEventEligible', () => {
  it('gates on the inclusive week range', () => {
    const e = memo('m', 2, 4);
    expect(isEventEligible(e, createInitialState())).toBe(false);
    expect(isEventEligible(e, { ...createInitialState(), week: 2 })).toBe(true);
    expect(isEventEligible(e, { ...createInitialState(), week: 4 })).toBe(true);
    expect(isEventEligible(e, { ...createInitialState(), week: 5 })).toBe(false);
  });

  it('requires every requires flag and no forbids flag', () => {
    const requires = memo('m', 1, 12, { requires: ['alpha', 'beta'] });
    expect(isEventEligible(requires, createInitialState())).toBe(false);
    expect(isEventEligible(requires, addFlag(createInitialState(), 'alpha'))).toBe(false);
    expect(
      isEventEligible(requires, addFlag(addFlag(createInitialState(), 'alpha'), 'beta')),
    ).toBe(true);

    const forbids = memo('m', 1, 12, { forbids: ['alpha'] });
    expect(isEventEligible(forbids, createInitialState())).toBe(true);
    expect(isEventEligible(forbids, addFlag(createInitialState(), 'alpha'))).toBe(false);
  });

  it('excludes events already seen this playthrough', () => {
    const e = memo('seen', 1, 12);
    expect(isEventEligible(e, createInitialState(), new Set(['seen']))).toBe(false);
    expect(isEventEligible(e, createInitialState(), new Set(['other']))).toBe(true);
  });

  it('does not look at stats — only week, flags and history gate a memo', () => {
    const e = memo('m', 1, 1);
    const low = setStat(setDrift(createInitialState(), 90), 'composure', 1);
    expect(isEventEligible(e, low)).toBe(true);
  });
});

describe('eligibleEvents', () => {
  it('returns every gate-passing event in pool order', () => {
    const ids = eligibleEvents(pool, createInitialState()).map((e) => e.id);
    expect(ids).toEqual(['w1', 'w2', 'no-flaggy']);
  });

  it('honours the seen set and flags together', () => {
    const state = addFlag(createInitialState(), 'alpha');
    expect(eligibleEvents(pool, state, new Set(['w1'])).map((e) => e.id)).toEqual([
      'w2',
      'flaggy',
    ]);
  });

  it('collapses duplicate ids in a malformed pool', () => {
    const dupe = [memo('same', 1, 12), memo('same', 1, 12)];
    expect(eligibleEvents(dupe, createInitialState()).map((e) => e.id)).toEqual(['same']);
  });

  it('treats a default seen set as empty', () => {
    expect(NO_EVENTS_SEEN.size).toBe(0);
    expect(eligibleEvents(pool, createInitialState(), NO_EVENTS_SEEN)).toHaveLength(3);
  });
});

describe('drawWeekEvents', () => {
  it('draws the requested count and marks the result seen', () => {
    const draw = drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, createRng('draw-1'), 2);
    expect(draw.events).toHaveLength(2);
    expect(draw.week).toBe(1);
    expect([...draw.seenEventIds]).toEqual(draw.events.map((e) => e.id));
    expect(NO_EVENTS_SEEN.size).toBe(0);
  });

  it('defaults to the max memos per week', () => {
    const draw = drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, createRng(1));
    expect(draw.events).toHaveLength(Math.min(MEMOS_PER_WEEK_MAX, 3));
  });

  it('is deterministic for a fixed seed', () => {
    const a = drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, createRng('fixed'), 3);
    const b = drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, createRng('fixed'), 3);
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect([...a.seenEventIds].sort()).toEqual([...b.seenEventIds].sort());
  });

  it('varies the order with the seed (the shuffle is real)', () => {
    const orders = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      orders.add(
        drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, createRng(seed), 3)
          .events.map((e) => e.id)
          .join(','),
      );
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('never repeats an event across weeks of one playthrough', () => {
    let seen: ReadonlySet<string> = NO_EVENTS_SEEN;
    let state = createInitialState();
    const landed: string[] = [];

    for (let week = 1; week <= 12; week++) {
      const draw = drawWeekEvents(pool, state, seen, createRng(`week-${week}`), 3);
      landed.push(...draw.events.map((e) => e.id));
      seen = draw.seenEventIds;
      state = advanceWeek(state);
    }

    expect(new Set(landed).size).toBe(landed.length);
    // 'flaggy' needs a flag this playthrough never sets, so it stays out.
    expect([...landed].sort()).toEqual(
      pool.filter((e) => e.id !== 'flaggy').map((e) => e.id).sort(),
    );
  });

  it('yields fewer memos when the pool runs dry instead of throwing', () => {
    const tiny = [memo('only', 1, 12)];
    const first = drawWeekEvents(tiny, createInitialState(), NO_EVENTS_SEEN, createRng(1), 3);
    expect(first.events).toHaveLength(1);

    const second = drawWeekEvents(tiny, createInitialState(), first.seenEventIds, createRng(1), 3);
    expect(second.events).toEqual([]);
    expect(second.seenEventIds.has('only')).toBe(true);
  });

  it('handles count 0 without consuming randomness', () => {
    const rng = createRng('zero');
    const before = rng.getState();
    const draw = drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, rng, 0);
    expect(draw.events).toEqual([]);
    expect(rng.getState()).toEqual(before);
    expect([...draw.seenEventIds]).toEqual([]);
  });

  it('rejects a negative or fractional count', () => {
    const rng = createRng(1);
    expect(() => drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, rng, -1)).toThrow(RangeError);
    expect(() => drawWeekEvents(pool, createInitialState(), NO_EVENTS_SEEN, rng, 1.5)).toThrow(RangeError);
  });

  it('does not mutate the seen set it is given', () => {
    const seen = new Set(['w1']);
    const before = new Set(seen);
    drawWeekEvents(pool, createInitialState(), seen, createRng(1), 3);
    expect([...seen]).toEqual([...before]);
  });
});
