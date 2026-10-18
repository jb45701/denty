/**
 * Drift data model.
 *
 * Source of truth: docs/SCOPE_LOCK.md ("Every judgment delegated instead of
 * verified buys time but adds Drift... displayed numbers/reports become quietly
 * perturbed — the UI lies to you; at high Drift, choices silently flip, or
 * displayed costs are false") and docs/DESIGN_BRIEF.md ("Drift rules").
 *
 * Drift is deliberately *not* carried on any of these records as a UI label:
 * the player never sees the number, only the consequences. Everything here is
 * plain serialisable data except `GameState`, which the store already owns.
 */

import type { CheckResult } from './event-types';
import type { GameState } from './types';

/** The three ways Drift accrues, in ascending severity (small / medium / large). */
export const DRIFT_CAUSES = [
  'unverifiedDelegation',
  'ignoredMemo',
  'acceptedDishonestReport',
] as const;
export type DriftCause = (typeof DRIFT_CAUSES)[number];

/** The ways Drift falls. DESIGN_BRIEF: verify -8, honest escalation -12. */
export const DRIFT_RELIEF_KINDS = ['verify', 'honestEscalation', 'quietWeek'] as const;
export type DriftReliefKind = (typeof DRIFT_RELIEF_KINDS)[number];

/** Any recorded reason Drift moved. */
export type DriftReason = DriftCause | DriftReliefKind;

/** Optional provenance for a Drift change, used by logs and tests. */
export interface DriftContext {
  readonly eventId?: string;
  readonly ticketId?: string;
}

/**
 * One applied Drift change.
 *
 * `delta` is the change that actually landed after the store's 0-100 clamp, so
 * a relief at Drift 3 reports -3, not -8.
 */
export interface DriftChange {
  readonly state: GameState;
  readonly reason: DriftReason;
  readonly kind: 'accrual' | 'relief';
  readonly delta: number;
  readonly before: number;
  readonly after: number;
  /** Dry narration line for the event log. */
  readonly log: string;
  readonly eventId?: string;
  readonly ticketId?: string;
}

/**
 * One number as the player is shown it.
 *
 * `actual` is the truth; `shown` is what the paperwork says. Below the
 * perturbation threshold they are identical and `offset` is 0.
 */
export interface DisplayedNumber {
  readonly actual: number;
  readonly shown: number;
  /** `shown - actual`, after clamping to the metric's own bounds. */
  readonly offset: number;
  readonly perturbed: boolean;
}

/** An action cost as displayed, which may not be the cost actually charged. */
export interface DisplayedCost {
  readonly actual: number;
  readonly shown: number;
  readonly misreported: boolean;
}

/** Both numbers revealed by a successful Scrutiny check. */
export interface RevealedNumbers {
  readonly shown: number;
  readonly actual: number;
  readonly disagreement: boolean;
}

/** The outcome of reading a report carefully at report time. */
export interface ReportScrutiny {
  readonly check: CheckResult;
  /** `null` when the check failed: the truth stays in the report. */
  readonly revealed: RevealedNumbers | null;
  readonly line: string;
}

/**
 * Whether this memo has a cursed choice, and which one.
 *
 * `choiceId` is `null` unless `flipped` is true. The roll is kept so a replay
 * can be audited; `probability` is the chance the memo carries a flip at all.
 */
export interface FlipDecision {
  readonly flipped: boolean;
  readonly choiceId: string | null;
  readonly probability: number;
  readonly roll: number | null;
  readonly drift: number;
}

/** Reports accepted at week close, and the Drift they cost. */
export interface DriftSettlement {
  readonly state: GameState;
  readonly changes: readonly DriftChange[];
}
