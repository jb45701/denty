/**
 * Ticket lifecycle — pure state machine for one dispatched ticket.
 *
 *     pending-ack --ack--> in-progress --verdict--> approved
 *                                            \--> sent-back (retry+1)
 *                                                  \--> escalation at retry 6
 *
 * Every function is `(ticket, ...) => ticket`: inputs are never mutated, and no
 * function touches the RNG (draws happen in verdicts.ts and are handed in).
 *
 * The cap is enforced structurally, not by prose: `applyVerdict` throws on a
 * ticket that is already at RETRY_ESCALATION_THRESHOLD, so an escalated ticket
 * can never receive a seventh review.
 */

import { RETRY_ESCALATION_THRESHOLD } from './constants';
import type { TicketRequest } from './event-types';
import type {
  DispatchOptions,
  Ticket,
  TicketReport,
  TicketStatus,
  UnitSpec,
} from './dispatch-types';
import { unitSpec } from './units';

/** A ticket that has not reached a terminal status yet. */
const OPEN_STATUSES: readonly TicketStatus[] = ['pending-ack', 'in-progress', 'sent-back'];

/** True while the pipeline still owns the ticket. */
export function isOpen(ticket: Ticket): boolean {
  return OPEN_STATUSES.includes(ticket.status);
}

/** Every open ticket, in dispatch order. */
export function openTickets(tickets: readonly Ticket[]): Ticket[] {
  return tickets.filter(isOpen);
}

/**
 * Build a ticket from a memo choice's `TicketRequest`.
 *
 * @param request the order produced by the memo runner (event-types.ts)
 * @param id deterministic ticket id, e.g. `ticket-1`
 * @param week dispatch week (1..12)
 * @param spec the receiving cell
 * @throws RangeError on a non-integer week or an out-of-range initial retry.
 */
export function createTicket(
  request: TicketRequest,
  id: string,
  week: number,
  spec: UnitSpec,
  options: DispatchOptions = {},
): Ticket {
  if (!Number.isInteger(week) || week < 1) {
    throw new RangeError(`createTicket: week must be a positive integer, received ${String(week)}`);
  }
  const initialRetry = options.initialRetry ?? 0;
  if (
    !Number.isInteger(initialRetry) ||
    initialRetry < 0 ||
    initialRetry >= RETRY_ESCALATION_THRESHOLD
  ) {
    throw new RangeError(
      `createTicket: initialRetry must be an integer in 0..${RETRY_ESCALATION_THRESHOLD - 1}, received ${String(initialRetry)}`,
    );
  }

  return {
    id,
    eventId: request.eventId,
    choiceId: request.choiceId,
    unit: request.unit,
    ticketType: request.ticketType,
    ...(request.note === undefined ? {} : { note: request.note }),
    status: 'pending-ack',
    retry: initialRetry,
    dispatchedWeek: week,
    ackDueWeek: week + spec.ackLatency,
    missedAcks: 0,
    reports: [],
  };
}

/** Record that the unit acknowledged the ticket: pending-ack -> in-progress. */
export function ackTicket(ticket: Ticket, week: number): Ticket {
  if (ticket.status !== 'pending-ack') {
    throw new Error(`ackTicket: ticket "${ticket.id}" is "${ticket.status}", not "pending-ack"`);
  }
  return { ...ticket, status: 'in-progress', ackedWeek: week };
}

/** Record a week that passed without an ack. Status does not change. */
export function recordMissedAck(ticket: Ticket): Ticket {
  if (ticket.status !== 'pending-ack') {
    throw new Error(
      `recordMissedAck: ticket "${ticket.id}" is "${ticket.status}", not "pending-ack"`,
    );
  }
  return { ...ticket, missedAcks: ticket.missedAcks + 1 };
}

/** The unit picks the ticket back up after a rejection: sent-back -> in-progress. */
export function beginRework(ticket: Ticket): Ticket {
  if (ticket.status !== 'sent-back') {
    throw new Error(`beginRework: ticket "${ticket.id}" is "${ticket.status}", not "sent-back"`);
  }
  return { ...ticket, status: 'in-progress' };
}

/** The seeded outcome of one review cycle, handed in from verdicts.ts. */
export interface VerdictInput {
  readonly verdict: 'approved' | 'sent-back';
  readonly week: number;
  /** The approval threshold the draw was made against, 0..1. */
  readonly approveProbability: number;
  /** The draw itself, 0..1. */
  readonly roll: number;
  /** Whether the unit's report is honest. */
  readonly honest: boolean;
}

/** The applied verdict plus the report it filed. */
export interface VerdictApplication {
  readonly ticket: Ticket;
  readonly report: TicketReport;
  /** True when this rejection pushed the ticket to the escalation cap. */
  readonly escalated: boolean;
}

function describeReport(
  ticket: Ticket,
  verdict: 'approved' | 'sent-back',
  retry: number,
  honest: boolean,
): string {
  const cell = unitSpec(ticket.unit).cell;
  const outcome = verdict === 'approved' ? 'approved.' : `sent back for rework (retry ${retry}).`;
  const annex = honest ? '' : ' The annex it cites is not attached.';
  return `${cell} closes ${ticket.id} (${ticket.ticketType}): ${outcome}${annex}`;
}

/**
 * Apply a review verdict.
 *
 * A rejection increments the retry counter; reaching the cap escalates instead
 * of scheduling another review. The report is appended to the ticket either way.
 *
 * @throws Error when the ticket is not in review, or is already at the cap.
 */
export function applyVerdict(ticket: Ticket, input: VerdictInput): VerdictApplication {
  if (ticket.status !== 'in-progress') {
    throw new Error(`applyVerdict: ticket "${ticket.id}" is "${ticket.status}", not "in-progress"`);
  }
  if (ticket.retry >= RETRY_ESCALATION_THRESHOLD) {
    throw new Error(
      `applyVerdict: ticket "${ticket.id}" is at the retry cap (${ticket.retry}) and must escalate, not be reviewed again`,
    );
  }

  if (input.verdict === 'approved') {
    const report: TicketReport = {
      ticketId: ticket.id,
      week: input.week,
      verdict: 'approved',
      approveProbability: input.approveProbability,
      roll: input.roll,
      honest: input.honest,
      summary: describeReport(ticket, 'approved', ticket.retry, input.honest),
    };
    return {
      ticket: {
        ...ticket,
        status: 'approved',
        reports: [...ticket.reports, report],
      },
      report,
      escalated: false,
    };
  }

  const retry = ticket.retry + 1;
  const escalated = retry >= RETRY_ESCALATION_THRESHOLD;
  const report: TicketReport = {
    ticketId: ticket.id,
    week: input.week,
    verdict: 'sent-back',
    approveProbability: input.approveProbability,
    roll: input.roll,
    honest: input.honest,
    summary: describeReport(ticket, 'sent-back', retry, input.honest),
  };

  return {
    ticket: {
      ...ticket,
      status: escalated ? 'escalated' : 'sent-back',
      retry,
      reports: [...ticket.reports, report],
    },
    report,
    escalated,
  };
}
