/**
 * The Drift display filter — the UI's liar.
 *
 * DESIGN_BRIEF: "Displayed values perturbed once Drift >= 40:
 * shown = true + seeded offset in [-Drift/10, +Drift/10], rounded." At
 * Drift >= 80 "displayed costs may be false."
 *
 * Two design constraints shape this module:
 *
 *   1. **Stable within a week.** The offset is drawn from a stream derived from
 *      `(seed, week, metric key)` — not from the shared turn RNG. A report does
 *      not change its lie when the UI redraws it, and rendering consumes no
 *      randomness from the game's sequence.
 *   2. **Bounded and integral.** The bound is `floor(Drift / 10)`, so every
 *      offset is an integer with `|offset| <= Drift / 10` (at Drift 40-49 the
 *      honest bound is 4.9 and the filter lies by at most 4). Shown values are
 *      then clamped to the metric's own 0-100 range.
 *
 * The filter never exposes Drift itself: `createDriftDisplay` only answers
 * "what does the paperwork say", and the player infers the rest.
 */

import {
  DISPLAY_COST_LIE_CHANCE,
  DRIFT_FLIP_THRESHOLD,
  DRIFT_MAX,
  DRIFT_MIN,
  DRIFT_PERTURBATION_THRESHOLD,
  READINESS_MAX,
  READINESS_MIN,
  STAT_MAX,
  STAT_MIN,
} from './constants';
import type { DisplayedCost, DisplayedNumber } from './drift-types';
import type { EventChoice, MemoEvent } from './event-types';
import { createRng, type Rng } from './rng';
import { clamp } from './state';
import type { GameState, StatName } from './types';

/**
 * The largest offset the filter may apply at a given Drift level.
 * 0 below the perturbation threshold; `floor(drift / 10)` above it.
 */
export function maxPerturbation(drift: number): number {
  if (drift < DRIFT_PERTURBATION_THRESHOLD) return 0;
  return Math.floor(clamp(drift, DRIFT_MIN, DRIFT_MAX) / 10);
}

/**
 * A private RNG stream for one display key.
 *
 * Derivation, not consumption: the game's shared RNG is untouched, so a
 * redraw can never desynchronise a replay. The parts are joined with a
 * separator that content ids cannot contain by convention, and the whole
 * string is hashed by the seeded RNG module.
 */
function derivedRng(seed: number | string, ...parts: readonly (string | number)[]): Rng {
  return createRng([String(seed), ...parts.map(String)].join('::'));
}

/** The rounded, bounded offset for one display key at one Drift level. */
export function perturbationOffset(
  drift: number,
  seed: number | string,
  key: string,
): number {
  const max = maxPerturbation(drift);
  if (max < 1) return 0;
  return derivedRng(seed, key).nextInclusive(-max, max);
}

function displayedNumber(
  actual: number,
  offset: number,
  min: number,
  max: number,
): DisplayedNumber {
  const shown = clamp(actual + offset, min, max);
  return { actual, shown, offset: shown - actual, perturbed: shown !== actual };
}

/** What the UI is allowed to show for a game state. */
export interface DriftDisplayFilter {
  readonly seed: number | string;
  /** The Mandate/Comprehension/Scrutiny/Composure number the player reads. */
  stat(state: GameState, stat: StatName): DisplayedNumber;
  /** The launch-readiness percentage the player reads. */
  readiness(state: GameState): DisplayedNumber;
  /** The action price a choice advertises, which may be false at high Drift. */
  actionCost(state: GameState, event: MemoEvent, choice: EventChoice): DisplayedCost;
}

/**
 * Build a display filter for one playthrough seed.
 *
 * The seed must be the same seed the RNG was built from; a save file carries
 * it, so a loaded game keeps lying consistently.
 */
export function createDriftDisplay(seed: number | string): DriftDisplayFilter {
  return {
    seed,

    stat(state, stat) {
      const offset = perturbationOffset(state.drift, seed, `stat:${state.week}:${stat}`);
      return displayedNumber(state.stats[stat], offset, STAT_MIN, STAT_MAX);
    },

    readiness(state) {
      const offset = perturbationOffset(state.drift, seed, `readiness:${state.week}`);
      return displayedNumber(state.launchReadiness, offset, READINESS_MIN, READINESS_MAX);
    },

    actionCost(state, event, choice) {
      const actual = choice.actionCost ?? 0;
      if (state.drift < DRIFT_FLIP_THRESHOLD) {
        return { actual, shown: actual, misreported: false };
      }

      const rng = derivedRng(seed, `cost:${state.week}:${event.id}:${choice.id}`);
      if (rng.next() >= DISPLAY_COST_LIE_CHANCE) {
        return { actual, shown: actual, misreported: false };
      }

      // The lie is always ±1 and never negative. A free choice can be shown
      // as costing one action; a one-action choice can be shown as free.
      const direction = rng.next() < 0.5 ? -1 : 1;
      let shown = Math.max(0, actual + direction);
      if (shown === actual) shown = actual + 1;
      return { actual, shown, misreported: shown !== actual };
    },
  };
}
