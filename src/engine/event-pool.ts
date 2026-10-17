/**
 * Event pool — gating and weekly draws.
 *
 * Gating is "week + flags" (SCOPE_LOCK: memos "gated by week + flags") plus the
 * per-playthrough memory of what has already landed:
 *
 *   weekMin <= state.week <= weekMax
 *   every `requires` flag is set
 *   no `forbids` flag is set
 *   the event id is not in the seen set
 *
 * The seen set is deliberately *not* part of GameState: the state shape is
 * frozen by the scope lock, and event history is a runner concern. Draws return
 * the updated set so a caller can persist it with save/load later.
 *
 * Drawing is seeded (`Rng.shuffle`) and marks everything it returns as seen, so
 * the same memo can never land twice in one playthrough, even across weeks.
 */

import { MEMOS_PER_WEEK_MAX } from './constants';
import type { Rng } from './rng';
import type { GameState } from './types';
import type { MemoEvent } from './event-types';

/** An empty seen-set; safe to share because it is never mutated. */
export const NO_EVENTS_SEEN: ReadonlySet<string> = new Set<string>();

/**
 * True when an event may surface this week.
 *
 * `seenEventIds` is optional; omit it to ask a pure "does the gate match"
 * question (as event authoring tests do).
 */
export function isEventEligible(
  event: MemoEvent,
  state: GameState,
  seenEventIds: ReadonlySet<string> = NO_EVENTS_SEEN,
): boolean {
  if (state.week < event.weekMin || state.week > event.weekMax) return false;
  if (seenEventIds.has(event.id)) return false;
  if (event.requires?.some((flag) => !state.flags.has(flag))) return false;
  if (event.forbids?.some((flag) => state.flags.has(flag))) return false;
  return true;
}

/**
 * Every eligible event, in pool order. Duplicate ids in a malformed pool are
 * collapsed to the first occurrence so the no-duplicate invariant holds even
 * when content is not validated first.
 */
export function eligibleEvents(
  pool: readonly MemoEvent[],
  state: GameState,
  seenEventIds: ReadonlySet<string> = NO_EVENTS_SEEN,
): MemoEvent[] {
  const out: MemoEvent[] = [];
  const taken = new Set<string>();
  for (const event of pool) {
    if (taken.has(event.id)) continue;
    if (!isEventEligible(event, state, seenEventIds)) continue;
    taken.add(event.id);
    out.push(event);
  }
  return out;
}

/** Result of opening a week's inbox. */
export interface WeekDraw {
  /** The week the draw happened in (mirrors `state.week`). */
  readonly week: number;
  /** The memos that landed, in seeded order. Fewer than `count` if the pool ran dry. */
  readonly events: readonly MemoEvent[];
  /** Seen set after the draw — pass this to the next call. */
  readonly seenEventIds: ReadonlySet<string>;
}

/**
 * Draw `count` memos for the current week.
 *
 * Returns at most `count` events: a thin pool yields fewer memos rather than
 * throwing, which is the game-like behaviour for a late week after most memos
 * have been seen. The input seen set is copied, never mutated.
 *
 * @throws RangeError when `count` is not a non-negative integer.
 */
export function drawWeekEvents(
  pool: readonly MemoEvent[],
  state: GameState,
  seenEventIds: ReadonlySet<string> = NO_EVENTS_SEEN,
  rng: Rng,
  count: number = MEMOS_PER_WEEK_MAX,
): WeekDraw {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`drawWeekEvents: count must be a non-negative integer, received ${String(count)}`);
  }

  const eligible = eligibleEvents(pool, state, seenEventIds);
  const picked = count === 0 ? [] : rng.shuffle(eligible).slice(0, Math.min(count, eligible.length));

  const seen = new Set(seenEventIds);
  for (const event of picked) seen.add(event.id);

  return { week: state.week, events: picked, seenEventIds: seen };
}
