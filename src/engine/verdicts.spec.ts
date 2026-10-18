import { describe, expect, it } from 'vitest';
import {
  REPORT_HONESTY_MAX,
  REPORT_HONESTY_MIN,
  VERDICT_APPROVE_MAX,
  VERDICT_APPROVE_MIN,
  VERDICT_DRIFT_PENALTY_PER_POINT,
  VERDICT_RETRY_PENALTY,
} from './constants';
import { createRng } from './rng';
import { UNIT_SPECS } from './units';
import {
  approveOdds,
  baseApproval,
  DEFAULT_TICKET_APPROVAL,
  drawReportHonesty,
  drawVerdict,
  TICKET_TYPE_APPROVAL,
} from './verdicts';

describe('baseApproval', () => {
  it('uses the per-type table', () => {
    expect(baseApproval('implementation')).toBe(TICKET_TYPE_APPROVAL.implementation);
    expect(baseApproval('signoff')).toBe(TICKET_TYPE_APPROVAL.signoff);
    expect(baseApproval('queue_triage')).toBe(0.7);
  });

  it('falls back to the default for a type the engine has never seen', () => {
    expect(baseApproval('unheard-of')).toBe(DEFAULT_TICKET_APPROVAL);
    expect(baseApproval('')).toBe(DEFAULT_TICKET_APPROVAL);
  });

  it('keeps every authored base a probability', () => {
    for (const value of Object.values(TICKET_TYPE_APPROVAL)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('approveOdds', () => {
  it('is base + unit bias - drift - retry', () => {
    const odds = approveOdds('implementation', 'reviewer', 2, 30);
    expect(odds.base).toBe(0.55);
    expect(odds.unitBias).toBe(UNIT_SPECS.reviewer.verdictBias);
    expect(odds.retryPenalty).toBeCloseTo(2 * VERDICT_RETRY_PENALTY, 12);
    expect(odds.driftPenalty).toBeCloseTo(30 * VERDICT_DRIFT_PENALTY_PER_POINT, 12);
    expect(odds.probability).toBeCloseTo(0.55 + 0.08 - 0.08 - 0.12, 12);
  });

  it('lowers approval as Drift rises', () => {
    const clean = approveOdds('implementation', 'coder', 0, 0).probability;
    const muddy = approveOdds('implementation', 'coder', 0, 40).probability;
    const ruined = approveOdds('implementation', 'coder', 0, 100).probability;
    expect(clean).toBeGreaterThan(muddy);
    expect(muddy).toBeGreaterThan(ruined);
  });

  it('lowers approval as retries pile up', () => {
    const probabilities = [0, 1, 3, 5].map(
      (retry) => approveOdds('implementation', 'coder', retry, 0).probability,
    );
    for (let index = 1; index < probabilities.length; index++) {
      expect(probabilities[index]!).toBeLessThan(probabilities[index - 1]!);
    }
  });

  it('modulates by ticket type at identical drift and unit', () => {
    const signoff = approveOdds('signoff', 'coder', 0, 20).probability;
    const implementation = approveOdds('implementation', 'coder', 0, 20).probability;
    expect(signoff).toBeGreaterThan(implementation);
  });

  it('clamps into the 5-95 band', () => {
    const floor = approveOdds('implementation', 'coder', 5, 100).probability;
    expect(floor).toBe(VERDICT_APPROVE_MIN);

    const ceiling = approveOdds('signoff', 'reviewer', 0, 0).probability;
    expect(ceiling).toBe(VERDICT_APPROVE_MAX);
  });
});

describe('drawVerdict', () => {
  it('approves exactly when the roll is under the probability', () => {
    for (let seed = 0; seed < 100; seed++) {
      const draw = drawVerdict('implementation', 'coder', 0, 20, createRng(seed));
      expect(draw.roll).toBeGreaterThanOrEqual(0);
      expect(draw.roll).toBeLessThan(1);
      expect(draw.verdict).toBe(draw.roll < draw.odds.probability ? 'approved' : 'sent-back');
    }
  });

  it('reproduces the same draw for a fixed seed', () => {
    const a = drawVerdict('reconciliation', 'ops', 3, 55, createRng('verdict-seed'));
    const b = drawVerdict('reconciliation', 'ops', 3, 55, createRng('verdict-seed'));
    expect(a).toEqual(b);
  });

  it('produces both outcomes across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      seen.add(drawVerdict('implementation', 'coder', 0, 0, createRng(seed)).verdict);
    }
    expect([...seen].sort()).toEqual(['approved', 'sent-back']);
  });

  it('lands near the advertised probability over many seeds', () => {
    const odds = approveOdds('implementation', 'coder', 0, 0);
    let approved = 0;
    const trials = 3000;
    for (let seed = 0; seed < trials; seed++) {
      if (drawVerdict('implementation', 'coder', 0, 0, createRng(seed)).verdict === 'approved') {
        approved++;
      }
    }
    expect(approved / trials).toBeCloseTo(odds.probability, 1);
  });
});

describe('drawReportHonesty', () => {
  it('starts at the cell reliability and drops with Drift', () => {
    expect(drawReportHonesty('coder', 0, createRng(1)).probability).toBeCloseTo(
      UNIT_SPECS.coder.reportReliability,
      12,
    );
    const muddy = drawReportHonesty('coder', 40, createRng(1)).probability;
    expect(muddy).toBeLessThan(UNIT_SPECS.coder.reportReliability);
    expect(muddy).toBeCloseTo(UNIT_SPECS.coder.reportReliability - 40 / 250, 12);
  });

  it('clamps to the honesty band at extreme Drift', () => {
    expect(drawReportHonesty('ops', 100, createRng(1)).probability).toBeGreaterThanOrEqual(
      REPORT_HONESTY_MIN,
    );
    expect(drawReportHonesty('ops', 100, createRng(1)).probability).toBeLessThanOrEqual(
      REPORT_HONESTY_MAX,
    );
    // 0.82 - 100/250 = 0.42; still inside the band.
    expect(drawReportHonesty('ops', 100, createRng(1)).probability).toBeCloseTo(0.42, 12);
  });

  it('is deterministic and reports honest iff the roll is under the probability', () => {
    const a = drawReportHonesty('reviewer', 30, createRng('honesty'));
    const b = drawReportHonesty('reviewer', 30, createRng('honesty'));
    expect(a).toEqual(b);
    expect(a.honest).toBe(a.roll < a.probability);
  });

  it('produces both honest and dishonest reports across seeds', () => {
    const seen = new Set<boolean>();
    for (let seed = 0; seed < 200; seed++) {
      seen.add(drawReportHonesty('coder', 0, createRng(seed)).honest);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('lands near the advertised rate over many seeds', () => {
    let honest = 0;
    const trials = 3000;
    for (let seed = 0; seed < trials; seed++) {
      if (drawReportHonesty('reviewer', 0, createRng(seed)).honest) honest++;
    }
    expect(honest / trials).toBeCloseTo(UNIT_SPECS.reviewer.reportReliability, 1);
  });
});
