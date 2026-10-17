import { describe, expect, it } from 'vitest';
import {
  NO_EVENTS_SEEN,
  advanceWeek,
  availableChoices,
  createInitialState,
  createRng,
  drawWeekEvents,
  resolveChoice,
  validateEventPool,
  type Effect,
  type GameState,
  type MemoEvent,
} from '../../engine';
import { starterEventPool } from './index';

const ALL_EFFECT_KINDS = [
  'drift',
  'faction',
  'flag',
  'spawnTicket',
  'stat',
  'verify',
] as const;

function collectEffects(event: MemoEvent): Effect[] {
  const out: Effect[] = [];
  for (const choice of event.choices) {
    out.push(...choice.effects.effects);
    out.push(...(choice.onSuccess?.effects ?? []));
    out.push(...(choice.onFailure?.effects ?? []));
  }
  return out;
}

interface Playthrough {
  readonly state: GameState;
  readonly resolved: readonly { eventId: string; choiceId: string; roll?: number }[];
  readonly seen: ReadonlySet<string>;
}

/**
 * Replay 12 weeks from a fixed seed. Week number picks the choice index, so the
 * script walks different branches (dispatch, spend, ignore, check) rather than
 * always taking the first option. Used to prove the runner is deterministic end
 * to end, not just per call.
 */
function playthrough(seed: string): Playthrough {
  const rng = createRng(seed);
  let state = createInitialState();
  let seen: ReadonlySet<string> = NO_EVENTS_SEEN;
  const resolved: { eventId: string; choiceId: string; roll?: number }[] = [];

  for (let week = 1; week <= 12; week++) {
    const draw = drawWeekEvents(starterEventPool, state, seen, rng);
    seen = draw.seenEventIds;

    for (const event of draw.events) {
      const options = availableChoices(state, event);
      if (options.length === 0) continue;
      // Prefer the choice that makes you read the paperwork, so every replay
      // walks the seeded-check path; otherwise rotate by week for variety.
      const pick = options.find((option) => option.check !== undefined) ??
        options[(week * 7) % options.length];
      if (!pick) continue;
      const result = resolveChoice(state, event, pick.id, rng);
      resolved.push({
        eventId: event.id,
        choiceId: pick.id,
        ...(result.check ? { roll: result.check.roll } : {}),
      });
      state = result.state;
    }

    state = advanceWeek(state);
  }

  return { state, resolved, seen };
}

describe('starter event pool', () => {
  it('is authoring-valid (ids, weeks, 3-4 choices, branch pairing)', () => {
    expect(() => validateEventPool(starterEventPool)).not.toThrow();
  });

  it('uses kebab-case ids and snake_case flags', () => {
    for (const event of starterEventPool) {
      expect(event.id).toMatch(/^memo-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      for (const flag of event.requires ?? []) expect(flag).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      for (const flag of event.forbids ?? []) expect(flag).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      for (const effect of collectEffects(event)) {
        if (effect.kind === 'flag') {
          expect(effect.flag).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
        }
      }
    }
  });

  it('covers every effect kind the runner understands', () => {
    const kinds = new Set(starterEventPool.flatMap(collectEffects).map((e) => e.kind));
    expect([...kinds].sort()).toEqual([...ALL_EFFECT_KINDS].sort());
  });

  it('demonstrates both flag gating kinds and a seeded check', () => {
    expect(starterEventPool.some((e) => (e.requires?.length ?? 0) > 0)).toBe(true);
    expect(starterEventPool.some((e) => (e.forbids?.length ?? 0) > 0)).toBe(true);
    expect(
      starterEventPool.some((e) => e.choices.some((c) => c.check !== undefined)),
    ).toBe(true);
  });

  it('gates the reviewer-capacity memo behind the pressure flag', () => {
    const event = starterEventPool.find((e) => e.id === 'memo-reviewer-capacity');
    expect(event?.requires).toEqual(['reviewer_pressure']);
  });
});

describe('scripted playthrough', () => {
  it('runs 12 weeks without repeating a memo and ends in a valid state', () => {
    const { state, resolved, seen } = playthrough('denty-phase-2');
    expect(state.week).toBe(12);
    expect(new Set(resolved.map((r) => r.eventId)).size).toBe(resolved.length);
    expect(seen.size).toBe(resolved.length);

    for (const value of Object.values(state.stats)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    for (const value of Object.values(state.factions)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(state.drift).toBeGreaterThanOrEqual(0);
    expect(state.drift).toBeLessThanOrEqual(100);
    expect(resolved.length).toBeGreaterThanOrEqual(4);
  });

  it('is byte-identical when replayed from the same seed', () => {
    const a = playthrough('replay-me');
    const b = playthrough('replay-me');
    expect(a.resolved).toEqual(b.resolved);
    expect(a.state).toEqual(b.state);
    expect([...a.seen].sort()).toEqual([...b.seen].sort());
  });

  it('diverges when the seed changes', () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 20; i++) {
      signatures.add(JSON.stringify(playthrough(`seed-${i}`)));
    }
    // Different seeds consume the shuffle and the d100 differently, so a fixed
    // policy does not collapse every playthrough onto one trace.
    expect(signatures.size).toBeGreaterThan(1);
  });
});
