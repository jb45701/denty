/**
 * Review verdict model.
 *
 * DESIGN_BRIEF: "Review verdicts: reviewer cell returns approved or sent-back
 * (retry+1) per seeded probabilities modulated by ticket type and Drift."
 * SCOPE_LOCK repeats the shape: "Review verdicts: approved, or sent back with
 * retry+1."
 *
 *     approve = clamp(base[ticketType]
 *                     + unit.verdictBias
 *                     - drift  * VERDICT_DRIFT_PENALTY_PER_POINT
 *                     - retry  * VERDICT_RETRY_PENALTY,
 *                     VERDICT_APPROVE_MIN, VERDICT_APPROVE_MAX)
 *
 * Why each term:
 *   - type: a deploy is harder to sign off than a sign-off;
 *   - unit: the reviewer cell's own work reads well in review;
 *   - Drift: the paperwork degrades, so the work stops passing its own standard;
 *   - retry: a ticket already sent back four times is not getting better.
 *
 * The only randomness is the seeded `Rng` (AGENTS.md determinism rule). One
 * verdict consumes exactly one draw; one report-honesty roll consumes one more.
 */

import {
  REPORT_HONESTY_DRIFT_DIVISOR,
  REPORT_HONESTY_MAX,
  REPORT_HONESTY_MIN,
  VERDICT_APPROVE_MAX,
  VERDICT_APPROVE_MIN,
  VERDICT_DRIFT_PENALTY_PER_POINT,
  VERDICT_RETRY_PENALTY,
} from './constants';
import type { UnitName } from './event-types';
import type { Rng } from './rng';
import { clamp } from './state';
import { unitSpec } from './units';

/**
 * Base approval by ticket type. The keys are the ticket types Phase 2 content
 * already dispatches; unknown types fall back to `DEFAULT_TICKET_APPROVAL`, so a
 * content module can never crash the loop by inventing a type.
 */
export const TICKET_TYPE_APPROVAL: Readonly<Record<string, number>> = {
  implementation: 0.55,
  eval_resample: 0.65,
  queue_triage: 0.7,
  reconciliation: 0.6,
  consistency_review: 0.62,
  signoff: 0.9,
};

/** Fallback base approval for ticket types the engine has never seen. */
export const DEFAULT_TICKET_APPROVAL = 0.6;

/** Base approval for a ticket type. */
export function baseApproval(ticketType: string): number {
  return TICKET_TYPE_APPROVAL[ticketType] ?? DEFAULT_TICKET_APPROVAL;
}

/** The full arithmetic behind one approval probability, kept for logs and tests. */
export interface VerdictOdds {
  readonly ticketType: string;
  readonly base: number;
  readonly unitBias: number;
  readonly retryPenalty: number;
  readonly driftPenalty: number;
  /** Final clamped probability in [VERDICT_APPROVE_MIN, VERDICT_APPROVE_MAX]. */
  readonly probability: number;
}

/** Approval odds for one ticket against the current Drift level. */
export function approveOdds(
  ticketType: string,
  unit: UnitName,
  retry: number,
  drift: number,
): VerdictOdds {
  const base = baseApproval(ticketType);
  const unitBias = unitSpec(unit).verdictBias;
  const retryPenalty = Math.max(0, retry) * VERDICT_RETRY_PENALTY;
  const driftPenalty = Math.max(0, drift) * VERDICT_DRIFT_PENALTY_PER_POINT;
  const probability = clamp(
    base + unitBias - retryPenalty - driftPenalty,
    VERDICT_APPROVE_MIN,
    VERDICT_APPROVE_MAX,
  );
  return { ticketType, base, unitBias, retryPenalty, driftPenalty, probability };
}

/** One seeded verdict draw. */
export interface VerdictDraw {
  readonly verdict: 'approved' | 'sent-back';
  readonly odds: VerdictOdds;
  /** The draw, 0..1. Approved iff `roll < odds.probability`. */
  readonly roll: number;
}

/** Draw a review verdict. Consumes exactly one RNG value. */
export function drawVerdict(
  ticketType: string,
  unit: UnitName,
  retry: number,
  drift: number,
  rng: Rng,
): VerdictDraw {
  const odds = approveOdds(ticketType, unit, retry, drift);
  const roll = rng.next();
  return { verdict: roll < odds.probability ? 'approved' : 'sent-back', odds, roll };
}

/** One seeded honesty roll for the report that follows a verdict. */
export interface HonestyDraw {
  /** Probability the report is honest, after Drift. */
  readonly probability: number;
  /** The draw, 0..1. Honest iff `roll < probability`. */
  readonly roll: number;
  readonly honest: boolean;
}

/**
 * Draw report honesty. DESIGN_BRIEF: reports "may be dishonest (reliability +
 * Drift)" — the cell's reliability is the ceiling, Drift eats into it.
 * Consumes exactly one RNG value.
 */
export function drawReportHonesty(unit: UnitName, drift: number, rng: Rng): HonestyDraw {
  const probability = clamp(
    unitSpec(unit).reportReliability - Math.max(0, drift) / REPORT_HONESTY_DRIFT_DIVISOR,
    REPORT_HONESTY_MIN,
    REPORT_HONESTY_MAX,
  );
  const roll = rng.next();
  return { probability, roll, honest: roll < probability };
}
