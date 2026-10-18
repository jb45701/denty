/**
 * Engine-wide numeric constants and invariant bounds.
 *
 * Source of truth: docs/SCOPE_LOCK.md (stats) + docs/DESIGN_BRIEF.md (starting
 * values, calendar, action economy). Nothing here may drift from those docs
 * without a scope-lock amendment.
 */

// Stats: Mandate / Comprehension / Scrutiny / Composure — 0..100, start 35.
export const STAT_MIN = 0;
export const STAT_MAX = 100;
export const STAT_START = 35;

// Faction standing: Acceleration / Governance / Doctrine — 0..100, start 50.
export const FACTION_MIN = 0;
export const FACTION_MAX = 100;
export const FACTION_START = 50;

// Drift — 0..100, starts 0. Hidden from direct display (UI filter, later phase).
export const DRIFT_MIN = 0;
export const DRIFT_MAX = 100;
export const DRIFT_START = 0;

// Launch readiness — computed from verified work. 0..100, starts 0.
export const READINESS_MIN = 0;
export const READINESS_MAX = 100;
export const READINESS_START = 0;

// Calendar: 12 weeks, fixed launch date at the end of week 12.
export const WEEK_START = 1;
export const WEEK_MAX = 12;

// Action economy: 3 actions per week.
export const ACTIONS_PER_WEEK = 3;

// Memos landing per week: DESIGN_BRIEF "2-3 memos land in the inbox".
export const MEMOS_PER_WEEK_MIN = 2;
export const MEMOS_PER_WEEK_MAX = 3;

// Stat checks (DESIGN_BRIEF: "stat checks resolve ... stat vs difficulty, seeded").
// The brief fixes the shape (stat vs difficulty, seeded) but not the curve, so
// the engine uses one legible d100 rule, implemented in event-runner.ts:
//
//     threshold = clamp(stat + modifier - difficulty + CHECK_MARGIN,
//                       CHECK_THRESHOLD_MIN, CHECK_THRESHOLD_MAX)
//     success   = d100 <= threshold
//
// A check at difficulty == stat therefore passes half the time; the clamp keeps
// every check between 5% and 95% so no memo choice is a guaranteed outcome.
export const CHECK_ROLL_MIN = 1;
export const CHECK_ROLL_MAX = 100;
export const CHECK_MARGIN = 50;
export const CHECK_THRESHOLD_MIN = 5;
export const CHECK_THRESHOLD_MAX = 95;

// VERIFY action (DESIGN_BRIEF: costs an action + Composure, Drift -8, reveals
// the true state of a report). The -8 is canon; the Composure price is the
// engine default for content that does not state its own.
export const VERIFY_DRIFT_RELIEF = 8;
export const VERIFY_COMPOSURE_COST = 4;

// Retry / escalation counter. SCOPE_LOCK: "a retry counter ticking toward
// escalation — cap 6, same as the real pipeline". At retry 6 the ticket is
// escalated and is never reviewed again.
export const RETRY_ESCALATION_THRESHOLD = 6;

// Review verdict model (DESIGN_BRIEF: "seeded probabilities modulated by ticket
// type and Drift"; the brief fixes the shape, not the numbers, so the engine
// owns one legible curve — see verdicts.ts).
export const VERDICT_APPROVE_MIN = 0.05;
export const VERDICT_APPROVE_MAX = 0.95;
// At Drift 40 this is -16pp; at Drift 100 it is -40pp.
export const VERDICT_DRIFT_PENALTY_PER_POINT = 0.004;
// A ticket already sent back four times is not getting better.
export const VERDICT_RETRY_PENALTY = 0.04;

// Dispatch loop Drift accrual. DESIGN_BRIEF: "+Drift on every unverified
// delegation outcome (small)". Every verdict is treated as unverified until the
// player verifies it, so each review cycle costs one point.
export const DISPATCH_DRIFT_PER_VERDICT = 1;

// Report honesty. DESIGN_BRIEF: reports "may be dishonest (reliability + Drift)".
// Drift eats into the cell's reliability; the floor keeps a report possibly
// honest and the ceiling keeps it possibly dishonest.
export const REPORT_HONESTY_DRIFT_DIVISOR = 250;
export const REPORT_HONESTY_MIN = 0.05;
export const REPORT_HONESTY_MAX = 0.99;

// Escalation handled honestly. DESIGN_BRIEF: "escalation handled honestly (-12)".
export const ESCALATION_HONEST_DRIFT_RELIEF = 12;

