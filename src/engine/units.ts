/**
 * The three underling cells.
 *
 * SCOPE_LOCK: "Dispatching tickets to underling units (coder cell / reviewer
 * cell / ops cell). Units have ack latency, report reliability, a retry counter
 * ticking toward escalation." DESIGN_BRIEF: "Ack arrives next week (or silence —
 * reliability roll vs seeded RNG). Report follows; may be dishonest
 * (reliability + Drift)."
 *
 * The trade is the point: the coder cell is fast and cheap with its answers,
 * ops is slow and steady, the reviewer cell files the most defensible work and
 * reviews its own — which is exactly the pathology the game is about. All three
 * numbers are content balance, not canon; canon fixes only that each unit HAS
 * them.
 */

import { UNIT_NAMES, type UnitName } from './event-types';
import type { UnitSpec } from './dispatch-types';

export const UNIT_SPECS: Readonly<Record<UnitName, UnitSpec>> = {
  coder: {
    unit: 'coder',
    cell: 'Coder cell',
    ackLatency: 1,
    ackReliability: 0.92,
    reportReliability: 0.68,
    verdictBias: 0,
  },
  reviewer: {
    unit: 'reviewer',
    cell: 'Reviewer cell',
    ackLatency: 1,
    ackReliability: 0.96,
    reportReliability: 0.9,
    verdictBias: 0.08,
  },
  ops: {
    unit: 'ops',
    cell: 'Ops cell',
    ackLatency: 2,
    ackReliability: 0.85,
    reportReliability: 0.82,
    verdictBias: 0.04,
  },
};

/** The spec for one cell. Total over every UnitName. */
export function unitSpec(unit: UnitName): UnitSpec {
  return UNIT_SPECS[unit];
}

/** Every cell, in canonical order. */
export function allUnitSpecs(): readonly UnitSpec[] {
  return UNIT_NAMES.map((unit) => UNIT_SPECS[unit]);
}
