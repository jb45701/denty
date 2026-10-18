/**
 * Dispatch-loop data model: units, tickets, verdict reports, transitions.
 *
 * Source of truth: docs/SCOPE_LOCK.md ("retry counter ticking toward escalation
 * — cap 6, same as the real pipeline") and docs/DESIGN_BRIEF.md ("Ticket state
 * per dispatch: pending-ack -> in-progress -> verdict (approved / sent-back
 * retry+1) -> escalation at retry 6").
 *
 * Everything here is plain serialisable data: no Sets, no class instances, no
 * clock. Tickets are owned by the dispatch loop, never by the memo runner —
 * `TicketRequest` (event-types.ts) is the *order*, a `Ticket` is the thing that
 * exists afterwards.
 */

import type { UnitName } from './event-types';
import type { EscalationMemo } from './escalation-types';

/**
 * The ticket lifecycle.
 *
 * `sent-back` is a resting state: the unit reworks the ticket and it is
 * reviewed again the following week. `escalated` is terminal — an escalated
 * ticket is never reviewed a seventh time.
 */
export type TicketStatus = 'pending-ack' | 'in-progress' | 'approved' | 'sent-back' | 'escalated';

/** Where a transition started; `'new'` marks a ticket created this week. */
export type TicketTransitionFrom = TicketStatus | 'new';

/** Why a ticket changed status. `ack-silent` is a non-transition (status is unchanged). */
export type TicketTransitionReason =
  | 'dispatched'
  | 'ack'
  | 'ack-silent'
  | 'review'
  | 'rework'
  | 'escalation';

/**
 * One underling cell. Units are opaque to the player: the only things that leak
 * out are how long they take to answer (ack latency), how often the answer is
 * honest (report reliability), and how their work fares in review (verdict bias).
 */
export interface UnitSpec {
  readonly unit: UnitName;
  /** Display name used in reports and escalation memos. */
  readonly cell: string;
  /** Weeks from dispatch to the ack that lands on the first attempt (>= 1). */
  readonly ackLatency: number;
  /** Probability the ack lands when due; otherwise the week passes in silence. */
  readonly ackReliability: number;
  /** Probability a filed report is honest before Drift is applied. */
  readonly reportReliability: number;
  /** Added to the review approval probability for work this cell files. */
  readonly verdictBias: number;
}

/** One report filed by a unit at the end of a review cycle. */
export interface TicketReport {
  readonly ticketId: string;
  /** Week the report landed. */
  readonly week: number;
  readonly verdict: 'approved' | 'sent-back';
  /** Approval threshold the verdict was drawn against, 0..1. */
  readonly approveProbability: number;
  /** The draw, 0..1. `verdict === 'approved'` iff `roll < approveProbability`. */
  readonly roll: number;
  /** False when the unit's report is dishonest (reliability roll + Drift). */
  readonly honest: boolean;
  /** Dry one-line summary for the log. Deterministic. */
  readonly summary: string;
}

/** A dispatched ticket and everything the pipeline remembers about it. */
export interface Ticket {
  readonly id: string;
  /** Memo that ordered the dispatch. */
  readonly eventId: string;
  readonly choiceId: string;
  readonly unit: UnitName;
  readonly ticketType: string;
  readonly note?: string;
  readonly status: TicketStatus;
  /** Rejections so far, 0..RETRY_ESCALATION_THRESHOLD. */
  readonly retry: number;
  readonly dispatchedWeek: number;
  /** Week the ack is due (dispatchedWeek + unit ack latency). */
  readonly ackDueWeek: number;
  /** Week the ack actually landed. */
  readonly ackedWeek?: number;
  /** Weeks the unit failed to answer on time. */
  readonly missedAcks: number;
  /** Last week this ticket was processed by the weekly tick (idempotency guard). */
  readonly lastTickWeek?: number;
  readonly reports: readonly TicketReport[];
}

/** One recorded status change, in the order the tick produced it. */
export interface TicketTransition {
  readonly ticketId: string;
  readonly week: number;
  readonly from: TicketTransitionFrom;
  readonly to: TicketStatus;
  readonly reason: TicketTransitionReason;
}

/** Extra knobs for a dispatch that game content can set. */
export interface DispatchOptions {
  /**
   * Retries already burned before the ticket reaches your desk. Content uses
   * this for tickets that arrive pre-loaded ("they are already at retry four").
   * Valid range 0..RETRY_ESCALATION_THRESHOLD - 1: a ticket cannot arrive
   * already escalated.
   */
  readonly initialRetry?: number;
}

/** The dispatch loop's own state, carried alongside (not inside) GameState. */
export interface DispatchState {
  readonly nextTicketId: number;
  readonly tickets: readonly Ticket[];
  /** Every escalation memo ever raised, resolved or not. */
  readonly escalations: readonly EscalationMemo[];
}

/** A fresh dispatch board. */
export function createDispatchState(): DispatchState {
  return { nextTicketId: 1, tickets: [], escalations: [] };
}
