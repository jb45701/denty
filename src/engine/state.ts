/**
 * Pure state store.
 *
 * Every export here is a pure function of `(state, ...) => newState`; nothing
 * mutates its input. Bounded fields are clamped on write, so a GameState
 * produced by this module always satisfies the engine invariants:
 *
 *   stats, factions, drift, launchReadiness  in [0, 100]
 *   week                                     in [1, 12]
 *   actionsRemaining                        >= 0
 *
 * The store is DOM-free and deterministic — no randomness, no clock (see rng.ts
 * for randomness).
 */

import {
  ACTIONS_PER_WEEK,
  DRIFT_MAX,
  DRIFT_MIN,
  DRIFT_START,
  FACTION_MAX,
  FACTION_MIN,
  FACTION_START,
  READINESS_MAX,
  READINESS_MIN,
  READINESS_START,
  STAT_MAX,
  STAT_MIN,
  STAT_START,
  WEEK_MAX,
  WEEK_START,
} from './constants';
import {
  FACTION_NAMES,
  STAT_NAMES,
  type FactionName,
  type FactionStanding,
  type GameState,
  type StatName,
  type Stats,
} from './types';

/**
 * Clamp a value into the inclusive range [min, max].
 * Non-finite input is a programmer error and throws rather than silently
 * producing a corrupt state.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`clamp: value must be finite, received ${String(value)}`);
  }
  return Math.min(max, Math.max(min, value));
}

export function clampStat(value: number): number {
  return clamp(value, STAT_MIN, STAT_MAX);
}

export function clampFaction(value: number): number {
  return clamp(value, FACTION_MIN, FACTION_MAX);
}

export function clampDrift(value: number): number {
  return clamp(value, DRIFT_MIN, DRIFT_MAX);
}

export function clampReadiness(value: number): number {
  return clamp(value, READINESS_MIN, READINESS_MAX);
}

/** The canonical new-game state. */
export function createInitialState(): GameState {
  return {
    stats: {
      mandate: STAT_START,
      comprehension: STAT_START,
      scrutiny: STAT_START,
      composure: STAT_START,
    },
    factions: {
      acceleration: FACTION_START,
      governance: FACTION_START,
      doctrine: FACTION_START,
    },
    drift: DRIFT_START,
    week: WEEK_START,
    actionsRemaining: ACTIONS_PER_WEEK,
    flags: new Set<string>(),
    launchReadiness: READINESS_START,
  };
}

// --- stats -----------------------------------------------------------------

/** Set a stat to an absolute value, clamped to [0, 100]. */
export function setStat(state: GameState, stat: StatName, value: number): GameState {
  const stats: Stats = { ...state.stats, [stat]: clampStat(value) };
  return { ...state, stats };
}

/** Add a delta to a stat, clamped to [0, 100]. Negative values are spends. */
export function adjustStat(state: GameState, stat: StatName, delta: number): GameState {
  return setStat(state, stat, state.stats[stat] + delta);
}

// --- faction standing ------------------------------------------------------

/** Set faction standing to an absolute value, clamped to [0, 100]. */
export function setFaction(state: GameState, faction: FactionName, value: number): GameState {
  const factions: FactionStanding = { ...state.factions, [faction]: clampFaction(value) };
  return { ...state, factions };
}

/** Add a delta to faction standing, clamped to [0, 100]. */
export function adjustFaction(
  state: GameState,
  faction: FactionName,
  delta: number,
): GameState {
  return setFaction(state, faction, state.factions[faction] + delta);
}

// --- drift -----------------------------------------------------------------

/** Set Drift to an absolute value, clamped to [0, 100]. */
export function setDrift(state: GameState, value: number): GameState {
  return { ...state, drift: clampDrift(value) };
}

/** Add a delta to Drift, clamped to [0, 100]. */
export function adjustDrift(state: GameState, delta: number): GameState {
  return setDrift(state, state.drift + delta);
}

// --- launch readiness ------------------------------------------------------

/** Set launch readiness to an absolute value, clamped to [0, 100]. */
export function setLaunchReadiness(state: GameState, value: number): GameState {
  return { ...state, launchReadiness: clampReadiness(value) };
}

/** Add a delta to launch readiness, clamped to [0, 100]. */
export function adjustLaunchReadiness(state: GameState, delta: number): GameState {
  return setLaunchReadiness(state, state.launchReadiness + delta);
}

// --- flags -----------------------------------------------------------------

export function hasFlag(state: GameState, flag: string): boolean {
  return state.flags.has(flag);
}

/** Add a flag. Adding an already-present flag is a no-op returning `state`. */
export function addFlag(state: GameState, flag: string): GameState {
  if (state.flags.has(flag)) return state;
  const flags = new Set(state.flags);
  flags.add(flag);
  return { ...state, flags };
}

/** Remove a flag. Removing an absent flag is a no-op returning `state`. */
export function removeFlag(state: GameState, flag: string): GameState {
  if (!state.flags.has(flag)) return state;
  const flags = new Set(state.flags);
  flags.delete(flag);
  return { ...state, flags };
}

/** Add several flags in order; identical to folding addFlag. */
export function addFlags(state: GameState, flags: readonly string[]): GameState {
  return flags.reduce(addFlag, state);
}

// --- action economy --------------------------------------------------------

/**
 * Spend `count` actions this week. Floors at 0 (an over-spend never produces a
 * negative count), which matches the store's floor invariant.
 */
export function spendAction(state: GameState, count = 1): GameState {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`spendAction: count must be a non-negative integer, received ${String(count)}`);
  }
  return { ...state, actionsRemaining: Math.max(0, state.actionsRemaining - count) };
}

/** True when at least `count` actions remain this week. */
export function hasActions(state: GameState, count = 1): boolean {
  return state.actionsRemaining >= count;
}

// --- calendar --------------------------------------------------------------

export function isFinalWeek(state: GameState): boolean {
  return state.week >= WEEK_MAX;
}

/**
 * Advance to the next week and refill the action pool. Week stops at 12; once
 * the launch week is reached, advancing is a no-op (launch resolves instead).
 */
export function advanceWeek(state: GameState): GameState {
  if (state.week >= WEEK_MAX) return state;
  return { ...state, week: state.week + 1, actionsRemaining: ACTIONS_PER_WEEK };
}

// --- invariants ------------------------------------------------------------

/**
 * Re-clamp every bounded field and deep-copy `flags`.
 *
 * Used as the last step of loading a state (save/load, later phase) so a
 * corrupt or hand-edited payload cannot leak an invalid value into the engine.
 * Always returns a fresh object; never throws for ordinary out-of-range input.
 */
export function normalize(state: GameState): GameState {
  const stats = Object.fromEntries(
    STAT_NAMES.map((name) => [name, clampStat(state.stats[name])]),
  ) as Record<StatName, number>;

  const factions = Object.fromEntries(
    FACTION_NAMES.map((name) => [name, clampFaction(state.factions[name])]),
  ) as Record<FactionName, number>;

  return {
    stats,
    factions,
    drift: clampDrift(state.drift),
    week: clamp(Math.trunc(state.week), WEEK_START, WEEK_MAX),
    actionsRemaining: Math.max(0, Math.trunc(state.actionsRemaining)),
    flags: new Set(state.flags),
    launchReadiness: clampReadiness(state.launchReadiness),
  };
}
