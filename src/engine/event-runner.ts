/**
 * Memo event runner — the pure heart of the dispatch loop's inbox.
 *
 * Two responsibilities, both deterministic:
 *
 *   1. `resolveCheck` turns a StatCheck into a d100 outcome. The only random
 *      draw in the whole module comes from the seeded `Rng`; `Math.random()`
 *      never appears here.
 *   2. `resolveChoice` validates availability, spends actions, applies the
 *      always-on effect bundle plus the check branch, and returns the new
 *      state together with the ticket/verify side records and narration log.
 *
 * Invariants:
 *   - the input GameState is never mutated (flags are copied by the store);
 *   - resolving the same choice twice with identically-seeded RNGs yields
 *     byte-identical results, including the roll;
 *   - a choice whose cost or requirements are unmet throws instead of silently
 *     resolving, so the UI must ask `availableChoices` first.
 */

import {
  CHECK_MARGIN,
  CHECK_ROLL_MAX,
  CHECK_ROLL_MIN,
  CHECK_THRESHOLD_MAX,
  CHECK_THRESHOLD_MIN,
  VERIFY_COMPOSURE_COST,
  VERIFY_DRIFT_RELIEF,
} from './constants';
import { Rng } from './rng';
import {
  addFlag,
  adjustDrift,
  adjustFaction,
  adjustStat,
  clamp,
  removeFlag,
  spendAction,
} from './state';
import type { GameState } from './types';
import type {
  CheckResult,
  ChoiceResolution,
  EffectBundle,
  EventChoice,
  MemoEvent,
  Requirement,
  StatCheck,
  TicketRequest,
  VerificationRecord,
} from './event-types';

/**
 * The d100 target for a check:
 *
 *     clamp(stat + modifier - difficulty + 50, 5, 95)
 *
 * On the 0-100 stat scale this reads plainly: a check at difficulty equal to
 * the stat passes half the time, a 20-point easier check passes 70% of the
 * time, and the clamp keeps every authored check in the 5-95% band.
 */
export function checkThreshold(check: StatCheck, state: GameState): number {
  const modifier = check.modifier ?? 0;
  return clamp(
    state.stats[check.stat] + modifier - check.difficulty + CHECK_MARGIN,
    CHECK_THRESHOLD_MIN,
    CHECK_THRESHOLD_MAX,
  );
}

/** Roll the seeded d100 and report pass/fail against the threshold. */
export function resolveCheck(check: StatCheck, state: GameState, rng: Rng): CheckResult {
  const threshold = checkThreshold(check, state);
  const roll = rng.nextInclusive(CHECK_ROLL_MIN, CHECK_ROLL_MAX);
  return {
    stat: check.stat,
    difficulty: check.difficulty,
    modifier: check.modifier ?? 0,
    roll,
    threshold,
    success: roll <= threshold,
  };
}

/** Human-readable reason a requirement is unmet, or `null` when it holds. */
function unmetRequirement(state: GameState, requirement: Requirement): string | null {
  switch (requirement.kind) {
    case 'flag':
      return state.flags.has(requirement.flag) ? null : `requires flag "${requirement.flag}"`;
    case 'noFlag':
      return state.flags.has(requirement.flag) ? `forbids flag "${requirement.flag}"` : null;
    case 'statAtLeast':
      return state.stats[requirement.stat] >= requirement.value
        ? null
        : `requires ${requirement.stat} >= ${requirement.value}`;
    case 'statAtMost':
      return state.stats[requirement.stat] <= requirement.value
        ? null
        : `requires ${requirement.stat} <= ${requirement.value}`;
    default: {
      const exhaustive: never = requirement;
      return `unknown requirement ${JSON.stringify(exhaustive)}`;
    }
  }
}

/** All unmet requirement reasons for a choice (empty when it is unlocked). */
export function unmetRequirements(
  state: GameState,
  requirements: readonly Requirement[],
): string[] {
  const reasons: string[] = [];
  for (const requirement of requirements) {
    const reason = unmetRequirement(state, requirement);
    if (reason !== null) reasons.push(reason);
  }
  return reasons;
}

/**
 * True when the player can pick this choice right now: every requirement holds
 * and the week still has enough actions to pay for it.
 */
export function isChoiceAvailable(state: GameState, choice: EventChoice): boolean {
  const cost = choice.actionCost ?? 0;
  if (cost > state.actionsRemaining) return false;
  return unmetRequirements(state, choice.requires ?? []).length === 0;
}

/** The choices currently open to the player, in authored order. */
export function availableChoices(state: GameState, event: MemoEvent): EventChoice[] {
  return event.choices.filter((choice) => isChoiceAvailable(state, choice));
}

function assertNever(value: unknown): never {
  throw new TypeError(`unhandled value ${JSON.stringify(value)}`);
}

interface AppliedEffects {
  state: GameState;
  tickets: TicketRequest[];
  verifications: VerificationRecord[];
}

/** Apply one bundle's effects in authored order. Pure: returns fresh values. */
function applyBundle(
  state: GameState,
  bundle: EffectBundle,
  event: MemoEvent,
  choice: EventChoice,
  into: AppliedEffects,
): void {
  let next = state;

  for (const effect of bundle.effects) {
    switch (effect.kind) {
      case 'stat':
        next = adjustStat(next, effect.stat, effect.delta);
        break;
      case 'faction':
        next = adjustFaction(next, effect.faction, effect.delta);
        break;
      case 'drift':
        next = adjustDrift(next, effect.delta);
        break;
      case 'flag':
        next = effect.value === false ? removeFlag(next, effect.flag) : addFlag(next, effect.flag);
        break;
      case 'spawnTicket':
        into.tickets.push({
          eventId: event.id,
          choiceId: choice.id,
          unit: effect.unit,
          ticketType: effect.ticketType,
          ...(effect.note === undefined ? {} : { note: effect.note }),
        });
        break;
      case 'verify': {
        const driftRelief = effect.driftRelief ?? VERIFY_DRIFT_RELIEF;
        const composureCost = effect.composureCost ?? VERIFY_COMPOSURE_COST;
        next = adjustDrift(next, -driftRelief);
        next = adjustStat(next, 'composure', -composureCost);
        into.verifications.push({
          eventId: event.id,
          choiceId: choice.id,
          ...(effect.target === undefined ? {} : { target: effect.target }),
          driftRelief,
          composureCost,
        });
        break;
      }
      default:
        assertNever(effect);
    }
  }

  into.state = next;
}

/**
 * Resolve one choice of one event.
 *
 * Order of operations, fixed so replays are identical:
 *   1. look up the choice, check `actionCost` and requirements (throw if unmet);
 *   2. spend the actions;
 *   3. roll the check (if any) — the *only* RNG consumption;
 *   4. apply the always-on bundle, then the success or failure bundle.
 *
 * @throws RangeError when the choice id does not exist.
 * @throws Error when the choice costs more actions than remain or is locked.
 */
export function resolveChoice(
  state: GameState,
  event: MemoEvent,
  choiceId: string,
  rng: Rng,
): ChoiceResolution {
  const choice = event.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) {
    throw new RangeError(`resolveChoice: event "${event.id}" has no choice "${choiceId}"`);
  }

  const actionCost = choice.actionCost ?? 0;
  if (actionCost > state.actionsRemaining) {
    throw new Error(
      `resolveChoice: choice "${choice.id}" costs ${actionCost} action(s), ${state.actionsRemaining} remaining`,
    );
  }
  const unmet = unmetRequirements(state, choice.requires ?? []);
  if (unmet.length > 0) {
    throw new Error(`resolveChoice: choice "${choice.id}" is locked (${unmet.join('; ')})`);
  }

  const spent = spendAction(state, actionCost);
  // Spending actions never changes stats, so rolling against the incoming state
  // is identical to rolling after the spend and keeps the check independent of
  // the action economy.
  const check = choice.check ? resolveCheck(choice.check, state, rng) : undefined;

  const applied: AppliedEffects = { state: spent, tickets: [], verifications: [] };
  const log: string[] = [];

  applyBundle(applied.state, choice.effects, event, choice, applied);
  log.push(...choice.effects.log);

  if (check) {
    const branch = check.success ? choice.onSuccess : choice.onFailure;
    if (!branch) {
      throw new TypeError(
        `resolveChoice: choice "${choice.id}" has a check but no ${check.success ? 'onSuccess' : 'onFailure'} bundle`,
      );
    }
    applyBundle(applied.state, branch, event, choice, applied);
    log.push(...branch.log);
  }

  return {
    eventId: event.id,
    choiceId: choice.id,
    state: applied.state,
    ...(check === undefined ? {} : { check }),
    tickets: applied.tickets,
    verifications: applied.verifications,
    actionsSpent: actionCost,
    log,
  };
}
