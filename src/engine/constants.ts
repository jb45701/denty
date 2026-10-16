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
