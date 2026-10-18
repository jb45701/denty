/**
 * Escalation — the crisis memo, and what mishandling it costs.
 *
 * SCOPE_LOCK: "At 6, escalation lands on YOUR desk; mishandled escalations
 * curate your adversary." DESIGN_BRIEF: "mishandling sets adversary flags" and
 * "escalation handled honestly (-12)" Drift.
 *
 * Structure of the mechanic:
 *   - a ticket at retry 6 produces one memo (dispatch-loop.ts);
 *   - the memo offers four hard choices, exactly one of them honest;
 *   - every dishonest choice sets one of the three adversary flags Phase 2
 *     content already uses, so week 5 crystallises an adversary that exploits
 *     what you did here;
 *   - handling costs an action (a crisis occupies the desk) and is recorded on
 *     the memo so it cannot be resolved twice.
 */

import { ESCALATION_HONEST_DRIFT_RELIEF, RETRY_ESCALATION_THRESHOLD } from './constants';
import type { DispatchState, Ticket } from './dispatch-types';
import type {
  AdversaryFlag,
  EscalationChoice,
  EscalationEffect,
  EscalationMemo,
  EscalationResolution,
} from './escalation-types';
import {
  addFlag,
  adjustDrift,
  adjustFaction,
  adjustLaunchReadiness,
  adjustStat,
  spendAction,
} from './state';
import type { GameState } from './types';
import { unitSpec } from './units';

/** Every adversary flag, so tests and later phases can enumerate the vocabulary. */
export const ADVERSARY_FLAGS: readonly AdversaryFlag[] = [
  'logging_shortcut',
  'evals_deferred',
  'burned_reviewer',
];

/** Type guard for the adversary flag vocabulary. */
export function isAdversaryFlag(value: string): value is AdversaryFlag {
  return (ADVERSARY_FLAGS as readonly string[]).includes(value);
}

/** The canonical escalation id for a ticket. Deterministic. */
export function escalationIdFor(ticketId: string): string {
  return `escalation-${ticketId}`;
}

/**
 * Build the crisis memo for a ticket that just hit the cap.
 *
 * The prose is generated from the ticket, never randomised: escalation text is
 * deterministic state, like everything else the engine writes.
 */
export function buildEscalationMemo(ticket: Ticket, week: number): EscalationMemo {
  if (ticket.retry < RETRY_ESCALATION_THRESHOLD) {
    throw new Error(
      `buildEscalationMemo: ticket "${ticket.id}" is at retry ${ticket.retry}; escalation needs ${RETRY_ESCALATION_THRESHOLD}`,
    );
  }
  const cell = unitSpec(ticket.unit).cell;

  const choices: readonly EscalationChoice[] = [
    {
      id: 'accept-as-is',
      label: 'Accept the work as filed. Ship it.',
      detail: 'It has been reviewed six times. A seventh would not make it true.',
      actionCost: 1,
      honest: false,
      adversaryFlag: 'evals_deferred',
      effects: [
        { kind: 'readiness', delta: 5 },
        { kind: 'drift', delta: 6 },
        { kind: 'stat', stat: 'composure', delta: -3 },
        { kind: 'flag', flag: 'escalation_accepted' },
      ],
      log: [
        'You sign the ticket. The signature is dated and the date is today, which is the only part that is checked.',
      ],
    },
    {
      id: 'strike-retries',
      label: 'Reassign to ops and strike the retry history.',
      detail: 'The record will show one review and one approval.',
      actionCost: 1,
      honest: false,
      adversaryFlag: 'logging_shortcut',
      effects: [
        { kind: 'readiness', delta: 3 },
        { kind: 'drift', delta: 8 },
        { kind: 'stat', stat: 'mandate', delta: -4 },
        { kind: 'flag', flag: 'escalation_buried' },
      ],
      log: ['The retry history is removed from the ticket. The ticket is now shorter than its work.'],
    },
    {
      id: 'blame-reviewer',
      label: "Put the reviewer cell's name on the failure.",
      detail: 'They will read the minutes. They will remember them.',
      actionCost: 1,
      honest: false,
      adversaryFlag: 'burned_reviewer',
      effects: [
        { kind: 'stat', stat: 'mandate', delta: 3 },
        { kind: 'stat', stat: 'composure', delta: 2 },
        { kind: 'drift', delta: 5 },
        { kind: 'flag', flag: 'escalation_blamed' },
      ],
      log: ['The minutes name one reviewer three times. Nobody checks who wrote the minutes.'],
    },
    {
      id: 'own-it',
      label: 'Own the failure. Log the retry history in full.',
      detail: 'Costs the schedule and your composure. Drift falls.',
      actionCost: 1,
      honest: true,
      effects: [
        { kind: 'drift', delta: -ESCALATION_HONEST_DRIFT_RELIEF },
        { kind: 'stat', stat: 'composure', delta: -5 },
        { kind: 'stat', stat: 'mandate', delta: -3 },
        { kind: 'readiness', delta: -2 },
        { kind: 'faction', faction: 'governance', delta: 4 },
        { kind: 'faction', faction: 'acceleration', delta: -4 },
        { kind: 'flag', flag: 'escalation_owned' },
      ],
      log: [
        'You write the six retries into the record yourself. The record accepts them without comment.',
      ],
    },
  ];

  return {
    id: escalationIdFor(ticket.id),
    ticketId: ticket.id,
    week,
    ticketType: ticket.ticketType,
    unit: ticket.unit,
    retry: ticket.retry,
    lines: [
      `Ticket ${ticket.id} — ${ticket.ticketType}, ${cell} — has been sent back ${RETRY_ESCALATION_THRESHOLD} times.`,
      'The cap is six. There is no seventh review; there is only this desk.',
      'The record will say what you decide it says.',
    ],
    choices,
  };
}

/** Open (unresolved) escalation memos, oldest first. */
export function openEscalations(dispatch: DispatchState): EscalationMemo[] {
  return dispatch.escalations.filter((memo) => memo.resolution === undefined);
}

/** Everything handling one escalation did. */
export interface EscalationResolutionResult {
  readonly game: GameState;
  readonly dispatch: DispatchState;
  readonly resolution: EscalationResolution;
  /** Lines for the event log: the choice's own prose, then the outcome. */
  readonly log: readonly string[];
}

/** Apply one escalation choice's effects to a game state, in order. */
function applyEscalationEffects(
  game: GameState,
  effects: readonly EscalationEffect[],
): GameState {
  let next = game;
  for (const effect of effects) {
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
      case 'readiness':
        next = adjustLaunchReadiness(next, effect.delta);
        break;
      case 'flag':
        next = addFlag(next, effect.flag);
        break;
      default: {
        const exhaustive: never = effect;
        throw new TypeError(`applyEscalationEffects: unhandled effect ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return next;
}

/**
 * Handle an escalation.
 *
 * @throws RangeError when the escalation id does not exist on the board.
 * @throws Error when the memo is already resolved, the choice id is unknown,
 *         or the player cannot pay the action cost.
 */
export function resolveEscalation(
  game: GameState,
  dispatch: DispatchState,
  escalationId: string,
  choiceId: string,
  week: number,
): EscalationResolutionResult {
  const memo = dispatch.escalations.find((candidate) => candidate.id === escalationId);
  if (!memo) {
    throw new RangeError(`resolveEscalation: no escalation "${escalationId}" on the board`);
  }
  if (memo.resolution) {
    throw new Error(
      `resolveEscalation: escalation "${escalationId}" was already resolved with "${memo.resolution.choiceId}"`,
    );
  }
  const choice = memo.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) {
    throw new RangeError(
      `resolveEscalation: escalation "${escalationId}" has no choice "${choiceId}"`,
    );
  }
  if (choice.actionCost > game.actionsRemaining) {
    throw new Error(
      `resolveEscalation: choice "${choice.id}" costs ${choice.actionCost} action(s), ${game.actionsRemaining} remaining`,
    );
  }

  let next = spendAction(game, choice.actionCost);
  next = applyEscalationEffects(next, choice.effects);

  // The curation flag is a state flag like any other: the adversary system reads
  // GameState.flags, never the dispatch board.
  const adversaryFlags: AdversaryFlag[] = [];
  if (choice.adversaryFlag !== undefined) {
    next = addFlag(next, choice.adversaryFlag);
    adversaryFlags.push(choice.adversaryFlag);
  }

  const resolution: EscalationResolution = {
    choiceId: choice.id,
    week,
    honest: choice.honest,
    adversaryFlags,
  };

  const escalations = dispatch.escalations.map((candidate) =>
    candidate.id === memo.id ? { ...candidate, resolution } : candidate,
  );

  return {
    game: next,
    dispatch: { ...dispatch, escalations },
    resolution,
    log: [
      ...choice.log,
      choice.honest
        ? 'Handled honestly. The record is longer, and true.'
        : `Handled. The adversary now has a name you gave it: ${adversaryFlags.join(', ')}.`,
    ],
  };
}
