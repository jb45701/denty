/**
 * Drift — the signature mechanic.
 *
 * Every judgment delegated instead of verified buys time and adds Drift. This
 * module owns the whole invisible bookkeeping:
 *
 *   - the accrual taxonomy (small delegation / medium ignored memo / large
 *     accepted dishonest report) and the relief taxonomy (verify, honest
 *     escalation, quiet week);
 *   - the high-Drift flip: at Drift >= 80 a memo may carry one cursed choice
 *     whose effect is inverted when it resolves;
 *   - the Scrutiny check a careful reader gets at report time.
 *
 * The display filter (drift-display.ts) owns what the UI *shows*; this module
 * owns what is *true*. Determinism: every draw comes from the seeded `Rng`
 * handed in by the caller. No `Math.random` (AGENTS.md).
 */

import {
  DISPATCH_DRIFT_PER_VERDICT,
  DRIFT_ACCEPTED_DISHONEST_REPORT,
  DRIFT_FLIP_THRESHOLD,
  DRIFT_IGNORED_MEMO,
  DRIFT_MAX,
  DRIFT_QUIET_WEEK_RELIEF,
  ESCALATION_HONEST_DRIFT_RELIEF,
  FLIP_BASE_PROBABILITY,
  SCRUTINY_REPORT_DIFFICULTY,
  VERIFY_DRIFT_RELIEF,
} from './constants';
import type { TicketReport } from './dispatch-types';
import type {
  DisplayedNumber,
  DriftCause,
  DriftChange,
  DriftContext,
  DriftReliefKind,
  DriftSettlement,
  FlipDecision,
  ReportScrutiny,
} from './drift-types';
import type {
  ChoiceResolution,
  Effect,
  EffectBundle,
  EventChoice,
  MemoEvent,
} from './event-types';
import { resolveCheck, resolveChoice } from './event-runner';
import type { Rng } from './rng';
import { adjustDrift, clamp } from './state';
import type { GameState } from './types';

/**
 * Drift accrued per cause.
 *
 * DESIGN_BRIEF fixes the ordering, not the numbers: unverified delegation is
 * "small", ignored memo "medium", accepted dishonest report "large". The engine
 * uses 1 / 3 / 6 so one large report costs six delegations and one ignored memo
 * costs three. `unverifiedDelegation` is the dispatch loop's existing
 * per-verdict cost, so the loop and this table cannot disagree.
 */
export const DRIFT_DELTA: Readonly<Record<DriftCause, number>> = {
  unverifiedDelegation: DISPATCH_DRIFT_PER_VERDICT,
  ignoredMemo: DRIFT_IGNORED_MEMO,
  acceptedDishonestReport: DRIFT_ACCEPTED_DISHONEST_REPORT,
};

/**
 * Drift removed per relief. The two canon numbers (VERIFY -8, honest escalation
 * -12) are imported from constants.ts rather than repeated. A quiet week is the
 * brief's third relief; it is worth 2 because it must never beat a VERIFY.
 */
export const DRIFT_RELIEF: Readonly<Record<DriftReliefKind, number>> = {
  verify: VERIFY_DRIFT_RELIEF,
  honestEscalation: ESCALATION_HONEST_DRIFT_RELIEF,
  quietWeek: DRIFT_QUIET_WEEK_RELIEF,
};

const DRIFT_CAUSE_LOG: Readonly<Record<DriftCause, string>> = {
  unverifiedDelegation:
    'A report is filed and accepted without verification. The record is now slightly wrong.',
  ignoredMemo: 'The memo goes into the drawer. The drawer does not resolve it.',
  acceptedDishonestReport:
    'You accept a report whose annex is missing. The record continues without you.',
};

const DRIFT_RELIEF_LOG: Readonly<Record<DriftReliefKind, string>> = {
  verify: 'You verify the work. One number in the record becomes true again.',
  honestEscalation: 'You log the escalation in full. The record is longer, and truer.',
  quietWeek: 'A week passes with nothing dispatched. The paperwork settles.',
};

// --- accrual ---------------------------------------------------------------

/**
 * Add Drift for one cause, clamped by the store.
 *
 * `delta` on the returned record is what actually landed (at Drift 99 a +6
 * report reports +1), which keeps logs and tests honest about the edge.
 */
export function accrueDrift(
  state: GameState,
  cause: DriftCause,
  context: DriftContext = {},
): DriftChange {
  const before = state.drift;
  const next = adjustDrift(state, DRIFT_DELTA[cause]);
  return {
    state: next,
    reason: cause,
    kind: 'accrual',
    delta: next.drift - before,
    before,
    after: next.drift,
    log: DRIFT_CAUSE_LOG[cause],
    ...context,
  };
}

/** Accrue the medium penalty for a memo the player simply ignores. */
export function ignoreMemo(state: GameState, event: MemoEvent): DriftChange {
  return accrueDrift(state, 'ignoredMemo', { eventId: event.id });
}

/**
 * Accept a filed report at week close.
 *
 * A report costs Drift only when it is dishonest AND was not verified: an
 * honest report was already true, and a verified one has been checked (the
 * VERIFY action pays its own relief). Returns `null` when nothing accrues so
 * callers can log only real changes.
 */
export function acceptReport(
  state: GameState,
  report: TicketReport,
  options: { readonly verified?: boolean } = {},
): DriftChange | null {
  if (report.honest || options.verified === true) return null;
  return accrueDrift(state, 'acceptedDishonestReport', { ticketId: report.ticketId });
}

/**
 * Settle every report a week filed, charging the large penalty for each
 * dishonest report whose ticket the player did not verify. Folds in report
 * order, so the result is deterministic.
 */
export function settleReportsUnderDrift(
  state: GameState,
  reports: readonly TicketReport[],
  options: { readonly verifiedTicketIds?: readonly string[] } = {},
): DriftSettlement {
  const verified = new Set(options.verifiedTicketIds ?? []);
  const changes: DriftChange[] = [];
  let next = state;

  for (const report of reports) {
    if (verified.has(report.ticketId)) continue;
    const change = acceptReport(next, report);
    if (change !== null) {
      changes.push(change);
      next = change.state;
    }
  }

  return { state: next, changes };
}

// --- relief ----------------------------------------------------------------

/** Remove Drift for one relief kind, flooring at 0. */
export function relieveDrift(
  state: GameState,
  kind: DriftReliefKind,
  context: DriftContext = {},
): DriftChange {
  const before = state.drift;
  const next = adjustDrift(state, -DRIFT_RELIEF[kind]);
  return {
    state: next,
    reason: kind,
    kind: 'relief',
    delta: next.drift - before,
    before,
    after: next.drift,
    log: DRIFT_RELIEF_LOG[kind],
    ...context,
  };
}

// --- the flip --------------------------------------------------------------

/**
 * Chance that a memo carries a cursed choice.
 *
 * 0 below Drift 80; 0.5 at exactly 80 (the brief says "may"), ramping to 1.0 at
 * Drift 100. The ramp makes the last weeks of a sloppy run genuinely unsafe
 * without making the mechanic a coin flip the moment it unlocks.
 */
export function flipProbability(drift: number): number {
  if (drift < DRIFT_FLIP_THRESHOLD) return 0;
  const span = DRIFT_MAX - DRIFT_FLIP_THRESHOLD;
  const ramp =
    ((clamp(drift, DRIFT_FLIP_THRESHOLD, DRIFT_MAX) - DRIFT_FLIP_THRESHOLD) / span) *
    (1 - FLIP_BASE_PROBABILITY);
  return clamp(FLIP_BASE_PROBABILITY + ramp, FLIP_BASE_PROBABILITY, 1);
}

/**
 * Decide whether this memo has a cursed choice, and which one.
 *
 * Order of draws is fixed: the may-flip roll first, then the choice pick only
 * when the memo is cursed. Below Drift 80 this consumes no randomness at all,
 * so the low-Drift game's RNG sequence is untouched by the mechanic.
 */
export function rollMemoFlip(state: GameState, event: MemoEvent, rng: Rng): FlipDecision {
  const probability = flipProbability(state.drift);
  if (probability === 0 || event.choices.length === 0) {
    return {
      flipped: false,
      choiceId: null,
      probability,
      roll: null,
      drift: state.drift,
    };
  }

  const roll = rng.next();
  if (roll >= probability) {
    return { flipped: false, choiceId: null, probability, roll, drift: state.drift };
  }

  return {
    flipped: true,
    choiceId: rng.pick(event.choices).id,
    probability,
    roll,
    drift: state.drift,
  };
}

/** Invert one numeric effect. Structural effects are left intact — see below. */
function invertEffect(effect: Effect): Effect {
  switch (effect.kind) {
    case 'stat':
    case 'faction':
    case 'drift':
      return { ...effect, delta: -effect.delta };
    default:
      // Flags, ticket spawns and verify actions are structure, not magnitude:
      // a flipped memo still dispatches, still sets its flag, still verifies.
      // What flips is the number the player was buying.
      return effect;
  }
}

function invertBundle(bundle: EffectBundle): EffectBundle {
  return { effects: bundle.effects.map(invertEffect), log: bundle.log };
}

/**
 * The cursed version of a choice: every stat/faction/Drift delta reversed.
 *
 * The log lines are kept verbatim. That is the mechanic: the narration still
 * describes what the player chose, and the state disagrees with it.
 */
export function flipChoice(choice: EventChoice): EventChoice {
  return {
    ...choice,
    effects: invertBundle(choice.effects),
    ...(choice.onSuccess === undefined ? {} : { onSuccess: invertBundle(choice.onSuccess) }),
    ...(choice.onFailure === undefined ? {} : { onFailure: invertBundle(choice.onFailure) }),
  };
}

/** One memo choice resolved under Drift, plus the flip that governed it. */
export interface DriftChoiceResolution {
  readonly resolution: ChoiceResolution;
  readonly flip: FlipDecision;
}

/**
 * Resolve a memo choice with the Drift flip applied.
 *
 * Composes the Phase 2 runner: roll the flip, and if the memo is cursed *and*
 * the player picked the cursed choice, resolve an inverted copy of that choice.
 * Everything else is delegated to `resolveChoice`, so availability, action
 * spending, checks and logging keep their single implementation.
 */
export function resolveMemoChoice(
  state: GameState,
  event: MemoEvent,
  choiceId: string,
  rng: Rng,
): DriftChoiceResolution {
  const flip = rollMemoFlip(state, event, rng);

  if (!flip.flipped || flip.choiceId !== choiceId) {
    return { resolution: resolveChoice(state, event, choiceId, rng), flip };
  }

  const cursed: MemoEvent = {
    ...event,
    choices: event.choices.map((candidate) =>
      candidate.id === choiceId ? flipChoice(candidate) : candidate,
    ),
  };
  return { resolution: resolveChoice(state, cursed, choiceId, rng), flip };
}

// --- scrutiny --------------------------------------------------------------

/**
 * Read a filed report carefully (DESIGN_BRIEF: "Scrutiny check at report time:
 * honest reading catches perturbation (shows both numbers, 'the report
 * disagrees with itself')").
 *
 * On success both numbers are revealed; on failure the discrepancy — if there
 * is one — stays in the report, and `revealed` is `null`. Consumes exactly one
 * seeded d100 draw.
 */
export function scrutinizeReport(
  state: GameState,
  report: DisplayedNumber,
  rng: Rng,
): ReportScrutiny {
  const check = resolveCheck(
    { stat: 'scrutiny', difficulty: SCRUTINY_REPORT_DIFFICULTY },
    state,
    rng,
  );

  if (!check.success) {
    return {
      check,
      revealed: null,
      line: 'You read the report twice. Both readings agree, which proves only that you read it twice.',
    };
  }

  const disagreement = report.shown !== report.actual;
  return {
    check,
    revealed: { shown: report.shown, actual: report.actual, disagreement },
    line: disagreement
      ? `Discrepancy: the report says ${report.shown}; the record says ${report.actual}; the report disagrees with itself.`
      : `No discrepancy: the report says ${report.shown}; the record says ${report.actual}.`,
  };
}
