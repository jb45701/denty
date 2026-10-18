import { describe, expect, it } from 'vitest';
import {
  CHECK_ROLL_MAX,
  CHECK_ROLL_MIN,
  DISPATCH_DRIFT_PER_VERDICT,
  DRIFT_ACCEPTED_DISHONEST_REPORT,
  DRIFT_FLIP_THRESHOLD,
  DRIFT_IGNORED_MEMO,
  DRIFT_MAX,
  DRIFT_QUIET_WEEK_RELIEF,
  ESCALATION_HONEST_DRIFT_RELIEF,
  SCRUTINY_REPORT_DIFFICULTY,
  VERIFY_DRIFT_RELIEF,
} from './constants';
import { createDispatchState, type TicketReport } from './dispatch-types';
import { dispatchTicket, tickDispatchWeek } from './dispatch-loop';
import {
  DRIFT_DELTA,
  DRIFT_RELIEF,
  acceptReport,
  accrueDrift,
  flipChoice,
  flipProbability,
  ignoreMemo,
  relieveDrift,
  resolveMemoChoice,
  rollMemoFlip,
  scrutinizeReport,
  settleReportsUnderDrift,
} from './drift';
import { createDriftDisplay } from './drift-display';
import { buildEscalationMemo, resolveEscalation } from './escalation';
import { resolveChoice } from './event-runner';
import type { EffectBundle, EventChoice, MemoEvent, TicketRequest } from './event-types';
import { createRng } from './rng';
import { createInitialState, setLaunchReadiness, setStat } from './state';
import { applyVerdict, ackTicket, createTicket } from './tickets';
import type { GameState } from './types';
import { unitSpec } from './units';

const NO_EFFECTS: EffectBundle = { effects: [], log: [] };

const CODER_REQUEST: TicketRequest = {
  eventId: 'memo-scope-confirmation',
  choiceId: 'dispatch-coder',
  unit: 'coder',
  ticketType: 'implementation',
};

function choice(overrides: Partial<EventChoice> & Pick<EventChoice, 'id'>): EventChoice {
  return { label: `Choice ${overrides.id}`, effects: NO_EFFECTS, ...overrides };
}

function memo(choices: readonly EventChoice[], id = 'memo-test'): MemoEvent {
  return {
    id,
    title: 'Test memo',
    weekMin: 1,
    weekMax: 12,
    memo: ['Line one.', 'Line two.'],
    choices,
  };
}

function filedReport(
  overrides: Partial<TicketReport> & Pick<TicketReport, 'ticketId'>,
): TicketReport {
  return {
    week: 2,
    verdict: 'approved',
    approveProbability: 0.5,
    roll: 0.4,
    honest: true,
    summary: 'filed.',
    ...overrides,
  };
}

function gameAt(week = 1, drift = 0): GameState {
  return { ...createInitialState(), week, drift };
}

/** First seed in a fixed scan whose flip decision satisfies the predicate. */
function seedForFlip(
  state: GameState,
  event: MemoEvent,
  predicate: (choiceId: string | null, flipped: boolean) => boolean,
): number {
  for (let seed = 0; seed < 5_000; seed++) {
    const flip = rollMemoFlip(state, event, createRng(seed));
    if (predicate(flip.choiceId, flip.flipped)) return seed;
  }
  throw new Error('no seed produced the wanted flip decision');
}

describe('Drift deltas — the accrual taxonomy', () => {
  it('orders the causes small < medium < large', () => {
    expect(DRIFT_DELTA.unverifiedDelegation).toBe(DISPATCH_DRIFT_PER_VERDICT);
    expect(DRIFT_DELTA.unverifiedDelegation).toBeLessThan(DRIFT_DELTA.ignoredMemo);
    expect(DRIFT_DELTA.ignoredMemo).toBeLessThan(DRIFT_DELTA.acceptedDishonestReport);
    expect(DRIFT_DELTA.ignoredMemo).toBe(DRIFT_IGNORED_MEMO);
    expect(DRIFT_DELTA.acceptedDishonestReport).toBe(DRIFT_ACCEPTED_DISHONEST_REPORT);
  });

  it('adds the delegation cost and records before/after', () => {
    const change = accrueDrift(gameAt(3, 10), 'unverifiedDelegation', {
      eventId: 'memo-a',
      ticketId: 'ticket-1',
    });
    expect(change.state.drift).toBe(10 + DISPATCH_DRIFT_PER_VERDICT);
    expect(change).toMatchObject({
      reason: 'unverifiedDelegation',
      kind: 'accrual',
      delta: DISPATCH_DRIFT_PER_VERDICT,
      before: 10,
      after: 11,
      eventId: 'memo-a',
      ticketId: 'ticket-1',
    });
    expect(change.log.length).toBeGreaterThan(0);
  });

  it('reports the delta that actually landed when clamped at 100', () => {
    const change = accrueDrift(gameAt(1, 99), 'acceptedDishonestReport');
    expect(change.state.drift).toBe(DRIFT_MAX);
    expect(change.after).toBe(DRIFT_MAX);
    expect(change.delta).toBe(1);
  });

  it('accrues the medium penalty for an ignored memo and tags the memo id', () => {
    const event = memo([choice({ id: 'ignore' })], 'memo-ignored');
    const change = ignoreMemo(gameAt(1, 5), event);
    expect(change.state.drift).toBe(5 + DRIFT_IGNORED_MEMO);
    expect(change.reason).toBe('ignoredMemo');
    expect(change.eventId).toBe('memo-ignored');
  });
});

describe('accepted reports — the large penalty', () => {
  it('charges nothing for an honest report', () => {
    expect(acceptReport(gameAt(), filedReport({ ticketId: 'ticket-1', honest: true }))).toBeNull();
  });

  it('charges the large penalty for a dishonest report', () => {
    const change = acceptReport(gameAt(2, 4), filedReport({ ticketId: 'ticket-7', honest: false }));
    expect(change).not.toBeNull();
    expect(change!.state.drift).toBe(4 + DRIFT_ACCEPTED_DISHONEST_REPORT);
    expect(change!.reason).toBe('acceptedDishonestReport');
    expect(change!.ticketId).toBe('ticket-7');
    expect(change!.kind).toBe('accrual');
  });

  it('charges nothing for a dishonest report that was verified', () => {
    const report = filedReport({ ticketId: 'ticket-7', honest: false });
    expect(acceptReport(gameAt(2, 4), report, { verified: true })).toBeNull();
  });

  it('settles a mixed week only for dishonest, unverified reports', () => {
    const reports = [
      filedReport({ ticketId: 'ticket-1', honest: true }),
      filedReport({ ticketId: 'ticket-2', honest: false }),
      filedReport({ ticketId: 'ticket-3', honest: false }),
    ];
    const settled = settleReportsUnderDrift(gameAt(2, 10), reports, {
      verifiedTicketIds: ['ticket-3'],
    });

    expect(settled.changes).toHaveLength(1);
    expect(settled.changes[0]!.ticketId).toBe('ticket-2');
    expect(settled.state.drift).toBe(10 + DRIFT_ACCEPTED_DISHONEST_REPORT);
  });

  it('settles an empty week without touching the state', () => {
    const state = gameAt(2, 10);
    const settled = settleReportsUnderDrift(state, []);
    expect(settled.state).toBe(state);
    expect(settled.changes).toEqual([]);
  });
});

describe('Drift relief — canon numbers', () => {
  it('prices VERIFY at -8 and honest escalation at -12', () => {
    expect(DRIFT_RELIEF.verify).toBe(8);
    expect(DRIFT_RELIEF.verify).toBe(VERIFY_DRIFT_RELIEF);
    expect(DRIFT_RELIEF.honestEscalation).toBe(12);
    expect(DRIFT_RELIEF.honestEscalation).toBe(ESCALATION_HONEST_DRIFT_RELIEF);
    expect(DRIFT_RELIEF.quietWeek).toBe(DRIFT_QUIET_WEEK_RELIEF);
    expect(DRIFT_RELIEF.quietWeek).toBeLessThan(DRIFT_RELIEF.verify);
  });

  it('applies each relief as a negative delta', () => {
    const verify = relieveDrift(gameAt(2, 20), 'verify', { ticketId: 'ticket-1' });
    expect(verify.state.drift).toBe(12);
    expect(verify).toMatchObject({ kind: 'relief', delta: -8, before: 20, after: 12 });

    const honest = relieveDrift(gameAt(2, 20), 'honestEscalation');
    expect(honest.state.drift).toBe(8);
    expect(honest.delta).toBe(-12);

    const quiet = relieveDrift(gameAt(2, 20), 'quietWeek');
    expect(quiet.state.drift).toBe(20 - DRIFT_QUIET_WEEK_RELIEF);
  });

  it('floors at 0 and reports what actually landed', () => {
    const change = relieveDrift(gameAt(2, 3), 'verify');
    expect(change.state.drift).toBe(0);
    expect(change.delta).toBe(-3);
    expect(change.after).toBe(0);
  });

  it('agrees with the escalation memo: handling it honestly removes 12', () => {
    const ticket = createTicket(CODER_REQUEST, 'ticket-1', 1, unitSpec('coder'), {
      initialRetry: 5,
    });
    const applied = applyVerdict(ackTicket(ticket, 2), {
      verdict: 'sent-back',
      week: 2,
      approveProbability: 0,
      roll: 1,
      honest: true,
    });
    expect(applied.escalated).toBe(true);

    const escalation = buildEscalationMemo(applied.ticket, 2);
    const dispatch = { ...createDispatchState(), escalations: [escalation] };
    const result = resolveEscalation(gameAt(3, 20), dispatch, escalation.id, 'own-it', 3);

    expect(result.resolution.honest).toBe(true);
    expect(result.game.drift).toBe(20 - ESCALATION_HONEST_DRIFT_RELIEF);
    expect(result.game.drift).toBe(8);
  });
});

describe('flipProbability', () => {
  it('is zero below Drift 80', () => {
    for (let drift = 0; drift < DRIFT_FLIP_THRESHOLD; drift++) {
      expect(flipProbability(drift)).toBe(0);
    }
  });

  it('is a coin flip at exactly 80 and certain at 100', () => {
    expect(flipProbability(80)).toBe(0.5);
    expect(flipProbability(90)).toBeCloseTo(0.75, 12);
    expect(flipProbability(100)).toBe(1);
    expect(flipProbability(500)).toBe(1);
  });

  it('rises monotonically with Drift', () => {
    let previous = -1;
    for (let drift = 80; drift <= 100; drift++) {
      const probability = flipProbability(drift);
      expect(probability).toBeGreaterThanOrEqual(previous);
      previous = probability;
    }
  });
});

describe('rollMemoFlip', () => {
  const event = memo([choice({ id: 'a' }), choice({ id: 'b' }), choice({ id: 'c' })]);

  it('does not flip and consumes no randomness below Drift 80', () => {
    const rng = createRng('quiet');
    const before = rng.getState();
    const flip = rollMemoFlip(gameAt(4, 79), event, rng);

    expect(flip).toEqual({
      flipped: false,
      choiceId: null,
      probability: 0,
      roll: null,
      drift: 79,
    });
    expect(rng.getState()).toEqual(before);
  });

  it('at Drift 100 always flips and names exactly one authored choice', () => {
    for (let seed = 0; seed < 50; seed++) {
      const flip = rollMemoFlip(gameAt(9, 100), event, createRng(seed));
      expect(flip.flipped).toBe(true);
      expect(['a', 'b', 'c']).toContain(flip.choiceId);
      expect(flip.roll).not.toBeNull();
    }
  });

  it('both flips and stays clean across seeds at Drift 80', () => {
    const outcomes = new Set<boolean>();
    const candidates = new Set<string | null>();
    for (let seed = 0; seed < 200; seed++) {
      const flip = rollMemoFlip(gameAt(9, 80), event, createRng(seed));
      outcomes.add(flip.flipped);
      candidates.add(flip.choiceId);
    }
    expect([...outcomes].sort()).toEqual([false, true]);
    expect(candidates.size).toBeGreaterThan(1);
    expect(candidates.has(null)).toBe(true);
  });

  it('picks the same cursed choice for the same seed', () => {
    const a = rollMemoFlip(gameAt(9, 100), event, createRng('fixed'));
    const b = rollMemoFlip(gameAt(9, 100), event, createRng('fixed'));
    expect(a).toEqual(b);
  });

  it('handles a memo with no choices without drawing', () => {
    const empty = memo([], 'memo-empty');
    const rng = createRng('empty');
    const before = rng.getState();
    expect(rollMemoFlip(gameAt(9, 100), empty, rng).flipped).toBe(false);
    expect(rng.getState()).toEqual(before);
  });
});

describe('flipChoice — what a cursed choice does', () => {
  it('inverts stat, faction and Drift deltas but leaves structure intact', () => {
    const original = choice({
      id: 'mixed',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'stat', stat: 'mandate', delta: 5 },
          { kind: 'faction', faction: 'governance', delta: -4 },
          { kind: 'drift', delta: 2 },
          { kind: 'flag', flag: 'signed' },
          { kind: 'spawnTicket', unit: 'coder', ticketType: 'implementation' },
          { kind: 'verify', target: 'ticket-9' },
        ],
        log: ['You sign it.'],
      },
    });

    const flipped = flipChoice(original);
    expect(flipped.effects.effects).toEqual([
      { kind: 'stat', stat: 'mandate', delta: -5 },
      { kind: 'faction', faction: 'governance', delta: 4 },
      { kind: 'drift', delta: -2 },
      { kind: 'flag', flag: 'signed' },
      { kind: 'spawnTicket', unit: 'coder', ticketType: 'implementation' },
      { kind: 'verify', target: 'ticket-9' },
    ]);
    expect(flipped.effects.log).toEqual(['You sign it.']);
    expect(flipped.actionCost).toBe(1);
  });

  it('inverts both check branches', () => {
    const original = choice({
      id: 'checked',
      check: { stat: 'scrutiny', difficulty: 10 },
      effects: NO_EFFECTS,
      onSuccess: { effects: [{ kind: 'stat', stat: 'comprehension', delta: 3 }], log: ['ok'] },
      onFailure: { effects: [{ kind: 'stat', stat: 'composure', delta: -3 }], log: ['no'] },
    });
    const flipped = flipChoice(original);
    expect(flipped.onSuccess?.effects).toEqual([
      { kind: 'stat', stat: 'comprehension', delta: -3 },
    ]);
    expect(flipped.onFailure?.effects).toEqual([{ kind: 'stat', stat: 'composure', delta: 3 }]);
  });
});

describe('resolveMemoChoice — flips at resolution', () => {
  const gainEvent = memo(
    [
      choice({
        id: 'a',
        effects: { effects: [{ kind: 'stat', stat: 'mandate', delta: 5 }], log: ['a'] },
      }),
      choice({
        id: 'b',
        effects: { effects: [{ kind: 'stat', stat: 'composure', delta: 7 }], log: ['b'] },
      }),
    ],
    'memo-gain',
  );

  it('is byte-identical to resolveChoice below Drift 80', () => {
    const state = gameAt(3, 79);
    const rngA = createRng('below');
    const rngB = createRng('below');

    const composed = resolveMemoChoice(state, gainEvent, 'a', rngA);
    const plain = resolveChoice(state, gainEvent, 'a', rngB);

    expect(composed.flip.flipped).toBe(false);
    expect(composed.resolution).toEqual(plain);
    expect(rngA.getState()).toEqual(rngB.getState());
  });

  it('inverts the chosen choice when it is the cursed one', () => {
    const state = gameAt(3, 100); // probability 1: always cursed
    const seed = seedForFlip(state, gainEvent, (choiceId, flipped) => flipped && choiceId === 'a');
    const result = resolveMemoChoice(state, gainEvent, 'a', createRng(seed));

    expect(result.flip.flipped).toBe(true);
    expect(result.flip.choiceId).toBe('a');
    expect(result.resolution.state.stats.mandate).toBe(35 - 5);
    // The narration still describes what the player chose.
    expect(result.resolution.log).toEqual(['a']);
  });

  it('applies the honest effect when the player picks the other choice', () => {
    const state = gameAt(3, 80);
    const seed = seedForFlip(state, gainEvent, (choiceId, flipped) => flipped && choiceId === 'a');

    const result = resolveMemoChoice(state, gainEvent, 'b', createRng(seed));
    expect(result.flip.flipped).toBe(true);
    expect(result.flip.choiceId).toBe('a');
    expect(result.resolution.state.stats.composure).toBe(35 + 7);
    expect(result.resolution.state.stats.mandate).toBe(35);
  });

  it('still dispatches, sets flags and verifies on a cursed choice', () => {
    const event = memo([
      choice({
        id: 'dispatch',
        effects: {
          effects: [
            { kind: 'stat', stat: 'mandate', delta: 4 },
            { kind: 'flag', flag: 'signed' },
            { kind: 'spawnTicket', unit: 'coder', ticketType: 'implementation' },
            { kind: 'drift', delta: 3 },
          ],
          log: ['dispatched'],
        },
      }),
    ]);

    const result = resolveMemoChoice(gameAt(3, 100), event, 'dispatch', createRng(2));
    expect(result.flip.flipped).toBe(true);
    expect(result.resolution.state.stats.mandate).toBe(35 - 4);
    // The +3 Drift was inverted to -3 against a state already parked at 100.
    expect(result.resolution.state.drift).toBe(97);
    expect(result.resolution.state.flags.has('signed')).toBe(true);
    expect(result.resolution.tickets).toHaveLength(1);
  });

  it('replays identically for a fixed seed', () => {
    const state = gameAt(6, 85);
    const a = resolveMemoChoice(state, gainEvent, 'a', createRng('replay'));
    const b = resolveMemoChoice(state, gainEvent, 'a', createRng('replay'));
    expect(a).toEqual(b);
  });
});

describe('scrutinizeReport', () => {
  const shown = { actual: 70, shown: 73, offset: 3, perturbed: true };

  function seedForScrutiny(success: boolean, state: GameState): number {
    for (let seed = 0; seed < 2_000; seed++) {
      const scrutiny = scrutinizeReport(state, shown, createRng(seed));
      if (scrutiny.check.success === success) return seed;
    }
    throw new Error(`no seed produced scrutiny success=${String(success)}`);
  }

  it('uses the Scrutiny stat and the canon difficulty', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 35);
    const scrutiny = scrutinizeReport(state, shown, createRng(1));
    expect(scrutiny.check.stat).toBe('scrutiny');
    expect(scrutiny.check.difficulty).toBe(SCRUTINY_REPORT_DIFFICULTY);
    expect(scrutiny.check.roll).toBeGreaterThanOrEqual(CHECK_ROLL_MIN);
    expect(scrutiny.check.roll).toBeLessThanOrEqual(CHECK_ROLL_MAX);
  });

  it('reveals both numbers and the disagreement on a successful read', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 100); // threshold clamps to 95
    const scrutiny = scrutinizeReport(state, shown, createRng(seedForScrutiny(true, state)));

    expect(scrutiny.check.success).toBe(true);
    expect(scrutiny.revealed).toEqual({ shown: 73, actual: 70, disagreement: true });
    expect(scrutiny.line).toContain('73');
    expect(scrutiny.line).toContain('70');
    expect(scrutiny.line).toContain('the report disagrees with itself');
  });

  it('reports agreement when the numbers match', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 100);
    const agreeing = { actual: 70, shown: 70, offset: 0, perturbed: false };
    const scrutiny = scrutinizeReport(state, agreeing, createRng(seedForScrutiny(true, state)));

    expect(scrutiny.revealed).toEqual({ shown: 70, actual: 70, disagreement: false });
    expect(scrutiny.line).toContain('70');
    expect(scrutiny.line).not.toContain('disagrees');
  });

  it('keeps the truth hidden when the check fails', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 0); // threshold clamps to 5
    const seed = seedForScrutiny(false, state);
    const scrutiny = scrutinizeReport(state, shown, createRng(seed));

    expect(scrutiny.check.success).toBe(false);
    expect(scrutiny.revealed).toBeNull();
    expect(scrutiny.line).not.toContain('73');
  });

  it('finds both outcomes across seeds at a starting Scrutiny', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 35);
    const outcomes = new Set<boolean>();
    for (let seed = 0; seed < 200; seed++) {
      outcomes.add(scrutinizeReport(state, shown, createRng(seed)).check.success);
    }
    expect([...outcomes].sort()).toEqual([false, true]);
  });

  it('consumes exactly one d100 draw', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 35);
    const rng = createRng('one-draw');
    scrutinizeReport(state, shown, rng);

    const standalone = createRng('one-draw');
    standalone.nextInclusive(CHECK_ROLL_MIN, CHECK_ROLL_MAX);
    expect(rng.getState()).toEqual(standalone.getState());
  });

  it('replays identically for a fixed seed', () => {
    const state = setStat(gameAt(2, 60), 'scrutiny', 50);
    expect(scrutinizeReport(state, shown, createRng('replay'))).toEqual(
      scrutinizeReport(state, shown, createRng('replay')),
    );
  });
});

describe('display filter + scrutiny together', () => {
  it('catches a perturbed report and prints both numbers', () => {
    const display = createDriftDisplay('caught');
    const base = { ...setLaunchReadiness(gameAt(7, 100), 70), week: 7 };

    // Find a week whose displayed readiness is actually perturbed.
    let read = display.readiness(base);
    for (let week = 1; week <= 12 && !read.perturbed; week++) {
      read = display.readiness({ ...base, week });
    }
    expect(read.perturbed).toBe(true);

    const state = setStat({ ...base, week: 7 }, 'scrutiny', 100);
    let scrutiny = scrutinizeReport(state, read, createRng(0));
    for (let seed = 0; seed < 200 && !scrutiny.check.success; seed++) {
      scrutiny = scrutinizeReport(state, read, createRng(seed));
    }

    expect(scrutiny.revealed).not.toBeNull();
    expect(scrutiny.revealed!.actual).toBe(70);
    expect(scrutiny.revealed!.shown).toBe(read.shown);
    expect(scrutiny.revealed!.disagreement).toBe(true);
    expect(scrutiny.line).toContain('the report disagrees with itself');
  });
});

describe('integration with the dispatch loop', () => {
  function firstReport(drift = 0): ReturnType<typeof tickDispatchWeek> {
    const board = dispatchTicket(createDispatchState(), CODER_REQUEST, 1).dispatch;
    for (let seed = 0; seed < 5_000; seed++) {
      const result = tickDispatchWeek(gameAt(2, drift), board, createRng(seed));
      if (result.reports.length > 0) return result;
    }
    throw new Error('no seed filed a report');
  }

  it('charges one unverified-delegation delta per verdict', () => {
    const result = firstReport();
    expect(result.reports).toHaveLength(1);
    expect(result.game.drift).toBe(DRIFT_DELTA.unverifiedDelegation);
  });

  it('charges the large penalty when the week\'s dishonest report is accepted', () => {
    const board = dispatchTicket(createDispatchState(), CODER_REQUEST, 1).dispatch;
    let result: ReturnType<typeof tickDispatchWeek> | undefined;
    for (let seed = 0; seed < 20_000; seed++) {
      const attempt = tickDispatchWeek(gameAt(2, 0), board, createRng(seed));
      if (attempt.reports[0]?.honest === false) {
        result = attempt;
        break;
      }
    }
    expect(result).toBeDefined();

    const settled = settleReportsUnderDrift(result!.game, result!.reports);
    expect(settled.changes).toHaveLength(1);
    expect(settled.state.drift).toBe(
      DRIFT_DELTA.unverifiedDelegation + DRIFT_DELTA.acceptedDishonestReport,
    );
  });

  it('charges only the small penalty when the report was honest', () => {
    const board = dispatchTicket(createDispatchState(), CODER_REQUEST, 1).dispatch;
    let result: ReturnType<typeof tickDispatchWeek> | undefined;
    for (let seed = 0; seed < 20_000; seed++) {
      const attempt = tickDispatchWeek(gameAt(2, 0), board, createRng(seed));
      if (attempt.reports[0]?.honest === true) {
        result = attempt;
        break;
      }
    }
    expect(result).toBeDefined();

    const settled = settleReportsUnderDrift(result!.game, result!.reports);
    expect(settled.changes).toEqual([]);
    expect(settled.state.drift).toBe(DRIFT_DELTA.unverifiedDelegation);
  });

  it('replays a Drift-heavy week identically for a fixed seed', () => {
    const board = dispatchTicket(createDispatchState(), CODER_REQUEST, 1).dispatch;
    const state = gameAt(9, 85);
    const event = memo([
      choice({
        id: 'a',
        actionCost: 1,
        effects: { effects: [{ kind: 'stat', stat: 'mandate', delta: 4 }], log: ['a'] },
      }),
      choice({
        id: 'b',
        actionCost: 1,
        effects: { effects: [{ kind: 'stat', stat: 'composure', delta: 4 }], log: ['b'] },
      }),
    ]);

    function playout(): unknown {
      const rng = createRng('drift-replay');
      const first = resolveMemoChoice(state, event, 'a', rng);
      const tick = tickDispatchWeek(first.resolution.state, board, rng);
      const display = createDriftDisplay('drift-replay');
      return {
        resolution: first.resolution,
        flip: first.flip,
        tick,
        shown: display.stat(tick.game, 'mandate'),
        rng: rng.getState(),
      };
    }

    expect(playout()).toEqual(playout());
  });
});
