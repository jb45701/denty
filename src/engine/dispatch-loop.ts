/**
 * The dispatch loop — one week of pipeline at a time.
 *
 * `dispatchTicket` turns a memo choice's `TicketRequest` into a live ticket.
 * `tickDispatchWeek` advances every open ticket by one week:
 *
 *   pending-ack --(ack roll)--> in-progress --(work + review)--> verdict
 *                                                       |
 *                                                       +--> rework next week
 *                                                       +--> escalate at retry 6
 *
 * Determinism contract:
 *   - tickets are processed in dispatch order;
 *   - each due ack consumes one `rng.chance` draw, each review consumes a
 *     verdict draw plus a report-honesty draw, always in that order;
 *   - a ticket processed in week N is not processed again in week N, so ticking
 *     the same week twice is a no-op and consumes no randomness.
 *
 * Drift: every verdict is an unverified delegation outcome. The accrual is
 * routed through drift.ts (`DRIFT_DELTA.unverifiedDelegation`) so the loop and
 * the Drift system share one taxonomy (DESIGN_BRIEF: "+Drift on every
 * unverified delegation outcome (small)").
 */

import { accrueDrift } from './drift';
import type {
  DispatchOptions,
  DispatchState,
  Ticket,
  TicketReport,
  TicketTransition,
} from './dispatch-types';
import type { TicketRequest } from './event-types';
import { buildEscalationMemo } from './escalation';
import type { EscalationMemo } from './escalation-types';
import type { Rng } from './rng';
import { ackTicket, applyVerdict, beginRework, createTicket, recordMissedAck } from './tickets';
import type { GameState } from './types';
import { unitSpec } from './units';
import { drawReportHonesty, drawVerdict } from './verdicts';

/** The board after one dispatch. */
export interface DispatchTicketResult {
  readonly dispatch: DispatchState;
  readonly ticket: Ticket;
  readonly transition: TicketTransition;
}

/**
 * Dispatch one ticket to a unit. Consumes no randomness: the ack is rolled by
 * the next week's tick.
 *
 * Ticket ids are deterministic (`ticket-1`, `ticket-2`, ...) so a replay from a
 * seed produces the same board.
 */
export function dispatchTicket(
  dispatch: DispatchState,
  request: TicketRequest,
  week: number,
  options: DispatchOptions = {},
): DispatchTicketResult {
  const id = `ticket-${dispatch.nextTicketId}`;
  const ticket = createTicket(request, id, week, unitSpec(request.unit), options);
  return {
    dispatch: {
      ...dispatch,
      nextTicketId: dispatch.nextTicketId + 1,
      tickets: [...dispatch.tickets, ticket],
    },
    ticket,
    transition: {
      ticketId: id,
      week,
      from: 'new',
      to: 'pending-ack',
      reason: 'dispatched',
    },
  };
}

/** One week of the pipeline. */
export interface DispatchWeekResult {
  /** GameState with the week's Drift accrual applied; the input is untouched. */
  readonly game: GameState;
  readonly dispatch: DispatchState;
  /** Status changes in the order they happened. */
  readonly transitions: readonly TicketTransition[];
  /** Reports filed this week, in ticket order. */
  readonly reports: readonly TicketReport[];
  /** Escalation memos raised this week (also present on `dispatch.escalations`). */
  readonly escalations: readonly EscalationMemo[];
  readonly log: readonly string[];
}

/**
 * Advance every open ticket by one week.
 *
 * The week and Drift level are read from `game`, so the dispatch loop never
 * keeps its own clock and always agrees with the store.
 */
export function tickDispatchWeek(
  game: GameState,
  dispatch: DispatchState,
  rng: Rng,
): DispatchWeekResult {
  const week = game.week;
  const tickets = dispatch.tickets.slice();
  const transitions: TicketTransition[] = [];
  const reports: TicketReport[] = [];
  const newEscalations: EscalationMemo[] = [];
  const log: string[] = [];
  let nextGame = game;

  for (let index = 0; index < tickets.length; index++) {
    let ticket = tickets[index]!;

    if (ticket.status === 'approved' || ticket.status === 'escalated') continue;
    // Idempotency: a ticket already processed this week is left alone. This is
    // what makes a second tick in the same week a pure no-op.
    if (ticket.lastTickWeek === week) continue;

    const spec = unitSpec(ticket.unit);

    if (ticket.status === 'pending-ack') {
      if (week < ticket.ackDueWeek) continue;

      if (!rng.chance(spec.ackReliability)) {
        ticket = { ...recordMissedAck(ticket), lastTickWeek: week };
        tickets[index] = ticket;
        transitions.push({
          ticketId: ticket.id,
          week,
          from: 'pending-ack',
          to: 'pending-ack',
          reason: 'ack-silent',
        });
        log.push(`${spec.cell} does not acknowledge ${ticket.id} this week.`);
        continue;
      }

      ticket = ackTicket(ticket, week);
      transitions.push({
        ticketId: ticket.id,
        week,
        from: 'pending-ack',
        to: 'in-progress',
        reason: 'ack',
      });
      log.push(`${spec.cell} acknowledges ${ticket.id}.`);
    }

    if (ticket.status === 'sent-back') {
      ticket = beginRework(ticket);
      transitions.push({
        ticketId: ticket.id,
        week,
        from: 'sent-back',
        to: 'in-progress',
        reason: 'rework',
      });
      log.push(`${spec.cell} reworks ${ticket.id} (retry ${ticket.retry}).`);
    }

    // Acknowledged and worked in the same week: the unit files its report while
    // the week closes, so one retry cycle costs one week.
    const drawn = drawVerdict(ticket.ticketType, ticket.unit, ticket.retry, game.drift, rng);
    const honesty = drawReportHonesty(ticket.unit, game.drift, rng);
    const applied = applyVerdict(ticket, {
      verdict: drawn.verdict,
      week,
      approveProbability: drawn.odds.probability,
      roll: drawn.roll,
      honest: honesty.honest,
    });

    ticket = { ...applied.ticket, lastTickWeek: week };
    tickets[index] = ticket;
    reports.push(applied.report);
    nextGame = accrueDrift(nextGame, 'unverifiedDelegation', {
      eventId: ticket.eventId,
      ticketId: ticket.id,
    }).state;
    log.push(applied.report.summary);

    transitions.push({
      ticketId: ticket.id,
      week,
      from: 'in-progress',
      to: ticket.status,
      reason: applied.escalated ? 'escalation' : 'review',
    });

    if (applied.escalated) {
      const memo = buildEscalationMemo(ticket, week);
      newEscalations.push(memo);
      log.push(`Escalation ${memo.id}: ${ticket.id} is on your desk.`);
    }
  }

  return {
    game: nextGame,
    dispatch: {
      ...dispatch,
      tickets,
      escalations: [...dispatch.escalations, ...newEscalations],
    },
    transitions,
    reports,
    escalations: newEscalations,
    log,
  };
}
