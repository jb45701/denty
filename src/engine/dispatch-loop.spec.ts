import { describe, expect, it } from 'vitest';
import { DISPATCH_DRIFT_PER_VERDICT, RETRY_ESCALATION_THRESHOLD } from './constants';
import {
  createDispatchState,
  type DispatchState,
} from './dispatch-types';
import {
  dispatchTicket,
  tickDispatchWeek,
  type DispatchWeekResult,
} from './dispatch-loop';
import { DEFAULT_TICKET_APPROVAL, approveOdds } from './verdicts';
import { openEscalations } from './escalation';
import type { TicketRequest } from './event-types';
import { createRng, type Rng } from './rng';
import { createInitialState } from './state';
import { resolveChoice } from './event-runner';
import { scopeConfirmation } from '../game/events/early-memos';
import type { GameState } from './types';
import { createTicket } from './tickets';
import { unitSpec } from './units';

const CODER_REQUEST: TicketRequest = {
  eventId: 'memo-scope-confirmation',
  choiceId: 'dispatch-coder',
  unit: 'coder',
  ticketType: 'implementation',
};

const OPS_REQUEST: TicketRequest = {
  eventId: 'memo-reviewer-capacity',
  choiceId: 'dispatch-ops',
  unit: 'ops',
  ticketType: 'queue_triage',
};

const REVIEWER_REQUEST: TicketRequest = {
  eventId: 'memo-eval-sampling',
  choiceId: 'dispatch-reviewer',
  unit: 'reviewer',
  ticketType: 'eval_resample',
};

function gameAt(week: number, drift = 0): GameState {
  return { ...createInitialState(), week, drift };
}

/** First seed whose tick files a report with the wanted verdict for the first ticket. */
function seedForVerdict(
  dispatch: DispatchState,
  week: number,
  verdict: 'approved' | 'sent-back',
  drift = 0,
): number {
  for (let seed = 0; seed < 20_000; seed++) {
    const result = tickDispatchWeek(gameAt(week, drift), dispatch, createRng(seed));
    if (result.reports[0]?.verdict === verdict) return seed;
  }
  throw new Error(`no seed filed a ${verdict} verdict in week ${week}`);
}

/** First seed whose tick produces a silent ack. */
function seedForSilence(dispatch: DispatchState, week: number): number {
  for (let seed = 0; seed < 20_000; seed++) {
    const result = tickDispatchWeek(gameAt(week), dispatch, createRng(seed));
    if (result.transitions[0]?.reason === 'ack-silent') return seed;
  }
  throw new Error(`no seed produced a silent ack in week ${week}`);
}

function dispatched(request: TicketRequest = CODER_REQUEST, week = 1): DispatchState {
  return dispatchTicket(createDispatchState(), request, week).dispatch;
}

describe('dispatchTicket', () => {
  it('turns a TicketRequest into a deterministic pending ticket', () => {
    const result = dispatchTicket(createDispatchState(), CODER_REQUEST, 1);
    expect(result.ticket).toMatchObject({
      id: 'ticket-1',
      eventId: 'memo-scope-confirmation',
      choiceId: 'dispatch-coder',
      unit: 'coder',
      ticketType: 'implementation',
      status: 'pending-ack',
      retry: 0,
      dispatchedWeek: 1,
      ackDueWeek: 2,
      missedAcks: 0,
      reports: [],
    });
    expect(result.transition).toEqual({
      ticketId: 'ticket-1',
      week: 1,
      from: 'new',
      to: 'pending-ack',
      reason: 'dispatched',
    });
    expect(result.dispatch.tickets).toHaveLength(1);
    expect(result.dispatch.nextTicketId).toBe(2);
  });

  it('numbers tickets in dispatch order across cells', () => {
    let board = createDispatchState();
    const first = dispatchTicket(board, CODER_REQUEST, 1);
    board = first.dispatch;
    const second = dispatchTicket(board, OPS_REQUEST, 1);
    board = second.dispatch;
    const third = dispatchTicket(board, REVIEWER_REQUEST, 1);

    expect([first.ticket.id, second.ticket.id, third.ticket.id]).toEqual([
      'ticket-1',
      'ticket-2',
      'ticket-3',
    ]);
    expect(third.ticket.ackDueWeek).toBe(2);
    expect(second.ticket.ackDueWeek).toBe(3);
  });

  it('honours a pre-loaded retry from content', () => {
    const result = dispatchTicket(createDispatchState(), CODER_REQUEST, 3, { initialRetry: 4 });
    expect(result.ticket.retry).toBe(4);
  });

  it('consumes no randomness until the week ticks', () => {
    const rng = createRng('dispatch-only');
    const before = rng.getState();
    dispatchTicket(createDispatchState(), CODER_REQUEST, 1);
    expect(rng.getState()).toEqual(before);
  });
});

describe('tickDispatchWeek — acknowledgement', () => {
  it('does nothing before the ack is due and consumes no randomness', () => {
    const board = dispatched();
    const rng = createRng('not-due');
    const before = rng.getState();
    const result = tickDispatchWeek(gameAt(1), board, rng);
    expect(result.transitions).toEqual([]);
    expect(result.dispatch).toEqual(board);
    expect(result.reports).toEqual([]);
    expect(rng.getState()).toEqual(before);
  });

  it('acks and reviews in the week the ack lands', () => {
    const board = dispatched();
    const seed = seedForVerdict(board, 2, 'approved');
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));

    expect(result.transitions.map((transition) => transition.reason)).toEqual(['ack', 'review']);
    expect(result.transitions[0]).toMatchObject({ from: 'pending-ack', to: 'in-progress' });
    expect(result.reports).toHaveLength(1);
    expect(result.dispatch.tickets[0]!.status).toBe('approved');
    expect(result.dispatch.tickets[0]!.ackedWeek).toBe(2);
    expect(result.game.drift).toBe(DISPATCH_DRIFT_PER_VERDICT);
  });

  it('lets a week pass in silence without filing a report', () => {
    const board = dispatched();
    const seed = seedForSilence(board, 2);
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));

    expect(result.transitions).toEqual([
      { ticketId: 'ticket-1', week: 2, from: 'pending-ack', to: 'pending-ack', reason: 'ack-silent' },
    ]);
    expect(result.dispatch.tickets[0]).toMatchObject({
      status: 'pending-ack',
      missedAcks: 1,
      retry: 0,
    });
    expect(result.reports).toEqual([]);
    expect(result.game.drift).toBe(0);
  });

  it('honours the ops cell two-week latency', () => {
    const board = dispatched(OPS_REQUEST);
    const early = tickDispatchWeek(gameAt(2), board, createRng(1));
    expect(early.transitions).toEqual([]);

    const seed = seedForVerdict(board, 3, 'approved');
    const late = tickDispatchWeek(gameAt(3), board, createRng(seed));
    expect(late.transitions.map((transition) => transition.reason)).toEqual(['ack', 'review']);
  });
});

describe('tickDispatchWeek — retry counting', () => {
  it('increments the retry counter on a rejection and reworks next week', () => {
    const board = dispatched();
    const firstSeed = seedForVerdict(board, 2, 'sent-back');
    const first = tickDispatchWeek(gameAt(2), board, createRng(firstSeed));
    expect(first.dispatch.tickets[0]).toMatchObject({ status: 'sent-back', retry: 1 });

    const secondSeed = seedForVerdict(first.dispatch, 3, 'sent-back');
    const second = tickDispatchWeek(gameAt(3), first.dispatch, createRng(secondSeed));
    expect(second.transitions.map((transition) => transition.reason)).toEqual([
      'rework',
      'review',
    ]);
    expect(second.dispatch.tickets[0]).toMatchObject({ status: 'sent-back', retry: 2 });
    expect(second.dispatch.tickets[0]!.reports).toHaveLength(2);
  });

  it('keeps a rejected ticket open until it approves or escalates', () => {
    const board = dispatched();
    const seed = seedForVerdict(board, 2, 'sent-back');
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));
    expect(result.dispatch.tickets[0]!.status).not.toBe('approved');
  });

  it('accumulates Drift once per verdict, not once per ticket', () => {
    let board = createDispatchState();
    board = dispatchTicket(board, CODER_REQUEST, 1).dispatch;
    board = dispatchTicket(board, REVIEWER_REQUEST, 1).dispatch;

    const seed = seedForVerdict(board, 2, 'approved');
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));
    expect(result.reports).toHaveLength(2);
    expect(result.game.drift).toBe(2 * DISPATCH_DRIFT_PER_VERDICT);
  });
});

describe('tickDispatchWeek — escalation', () => {
  it('escalates at exactly retry 6 and puts the memo on the board', () => {
    const board = dispatched(CODER_REQUEST);
    const retried = createTicket(
      CODER_REQUEST,
      'ticket-1',
      1,
      unitSpec('coder'),
      { initialRetry: RETRY_ESCALATION_THRESHOLD - 1 },
    );
    const atFive: DispatchState = { ...board, tickets: [retried] };

    const seed = seedForVerdict(atFive, 2, 'sent-back');
    const result = tickDispatchWeek(gameAt(2), atFive, createRng(seed));

    const ticket = result.dispatch.tickets[0]!;
    expect(ticket.retry).toBe(RETRY_ESCALATION_THRESHOLD);
    expect(ticket.status).toBe('escalated');
    expect(result.transitions.at(-1)!.reason).toBe('escalation');
    expect(result.transitions.at(-1)!.to).toBe('escalated');
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]!.ticketId).toBe('ticket-1');
    expect(result.escalations[0]!.retry).toBe(RETRY_ESCALATION_THRESHOLD);
    expect(result.dispatch.escalations).toHaveLength(1);
    expect(openEscalations(result.dispatch)).toHaveLength(1);
  });

  it('does not escalate at retry 5', () => {
    const retried = createTicket(CODER_REQUEST, 'ticket-1', 1, unitSpec('coder'), {
      initialRetry: RETRY_ESCALATION_THRESHOLD - 2,
    });
    const board: DispatchState = { ...createDispatchState(), tickets: [retried] };

    const seed = seedForVerdict(board, 2, 'sent-back');
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));

    expect(result.dispatch.tickets[0]!.retry).toBe(RETRY_ESCALATION_THRESHOLD - 1);
    expect(result.dispatch.tickets[0]!.status).toBe('sent-back');
    expect(result.escalations).toEqual([]);
  });

  it('never reviews an escalated ticket again', () => {
    const retried = createTicket(CODER_REQUEST, 'ticket-1', 1, unitSpec('coder'), {
      initialRetry: RETRY_ESCALATION_THRESHOLD - 1,
    });
    const board: DispatchState = { ...createDispatchState(), tickets: [retried] };
    const seed = seedForVerdict(board, 2, 'sent-back');
    const escalated = tickDispatchWeek(gameAt(2), board, createRng(seed));

    for (const week of [3, 4, 5]) {
      const later = tickDispatchWeek(gameAt(week), escalated.dispatch, createRng(week));
      expect(later.transitions).toEqual([]);
      expect(later.reports).toEqual([]);
      expect(later.escalations).toEqual([]);
      expect(later.dispatch.tickets[0]).toEqual(escalated.dispatch.tickets[0]);
    }
  });
});

describe('tickDispatchWeek — verdict modulation', () => {
  it('draws against the ticket type and unit odds', () => {
    const board = dispatched();
    const seed = seedForVerdict(board, 2, 'approved');
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));
    expect(result.reports[0]!.approveProbability).toBeCloseTo(
      approveOdds('implementation', 'coder', 0, 0).probability,
      12,
    );
  });

  it('falls back to the default odds for an unknown ticket type', () => {
    const board = dispatched({ ...CODER_REQUEST, ticketType: 'unheard-of' });
    const seed = seedForVerdict(board, 2, 'approved');
    const result = tickDispatchWeek(gameAt(2), board, createRng(seed));
    expect(result.reports[0]!.approveProbability).toBeCloseTo(DEFAULT_TICKET_APPROVAL, 12);
  });

  it('lowers the odds the loop draws against as Drift rises', () => {
    const board = dispatched();
    const clean = tickDispatchWeek(gameAt(2, 0), board, createRng(7));
    const muddy = tickDispatchWeek(gameAt(2, 80), board, createRng(7));
    expect(clean.reports[0]!.approveProbability).toBeGreaterThan(
      muddy.reports[0]!.approveProbability,
    );
  });

  it('reports honestly or dishonestly from the seeded reliability roll', () => {
    const board = dispatched();
    const honest: boolean[] = [];
    for (let seed = 0; seed < 200; seed++) {
      const result = tickDispatchWeek(gameAt(2), board, createRng(seed));
      if (result.reports[0]) honest.push(result.reports[0].honest);
    }
    const unique = [...new Set(honest)].sort();
    expect(unique).toEqual([false, true]);
  });
});

describe('tickDispatchWeek — board invariants', () => {
  it('processes tickets in dispatch order', () => {
    let board = createDispatchState();
    board = dispatchTicket(board, CODER_REQUEST, 1).dispatch;
    board = dispatchTicket(board, REVIEWER_REQUEST, 1).dispatch;

    let result: DispatchWeekResult | undefined;
    for (let seed = 0; seed < 2000; seed++) {
      const attempt = tickDispatchWeek(gameAt(2), board, createRng(seed));
      if (attempt.reports.length === 2) {
        result = attempt;
        break;
      }
    }
    expect(result).toBeDefined();
    expect(result!.reports.map((report) => report.ticketId)).toEqual(['ticket-1', 'ticket-2']);
    expect(result!.log[0]).toContain('ticket-1');
  });

  it('is idempotent within a week and consumes no randomness on the second tick', () => {
    const board = dispatched();
    const rng = createRng('twice');
    const first = tickDispatchWeek(gameAt(2), board, rng);
    const position = rng.getState();

    const second = tickDispatchWeek(gameAt(2), first.dispatch, rng);
    expect(second.transitions).toEqual([]);
    expect(second.reports).toEqual([]);
    expect(second.dispatch).toEqual(first.dispatch);
    expect(second.game).toEqual(first.game);
    expect(rng.getState()).toEqual(position);
  });

  it('does not mutate the game state or the board', () => {
    const board = dispatched();
    const game = gameAt(2, 20);
    const boardSnapshot = { ...board, tickets: [...board.tickets] };
    const gameSnapshot = {
      ...game,
      stats: { ...game.stats },
      factions: { ...game.factions },
      flags: new Set(game.flags),
    };

    tickDispatchWeek(game, board, createRng(1));
    expect(board).toEqual(boardSnapshot);
    expect(board.tickets).toEqual(boardSnapshot.tickets);
    expect(game).toEqual(gameSnapshot);
  });
});

describe('dispatch loop + memo runner', () => {
  it('consumes the TicketRequest the Phase 2 runner produces', () => {
    const resolution = resolveChoice(
      createInitialState(),
      scopeConfirmation,
      'dispatch-coder',
      createRng(1),
    );
    expect(resolution.tickets).toHaveLength(1);

    let board = createDispatchState();
    for (const request of resolution.tickets) {
      board = dispatchTicket(board, request, resolution.state.week).dispatch;
    }

    expect(board.tickets[0]).toMatchObject({
      id: 'ticket-1',
      eventId: 'memo-scope-confirmation',
      choiceId: 'dispatch-coder',
      unit: 'coder',
      ticketType: 'implementation',
      note: 'Annex C parity build',
      status: 'pending-ack',
    });

    // …and the ticket runs: ack, review, report, Drift.
    const seed = seedForVerdict(board, 2, 'approved');
    const week = tickDispatchWeek(gameAt(2), board, createRng(seed));
    expect(week.reports).toHaveLength(1);
    expect(week.game.drift).toBe(DISPATCH_DRIFT_PER_VERDICT);
  });
});

describe('tickDispatchWeek — determinism under a fixed seed', () => {
  function playout(seed: string): {
    dispatch: DispatchState;
    weeks: DispatchWeekResult[];
    rng: ReturnType<Rng['getState']>;
  } {
    const rng = createRng(seed);
    let board = createDispatchState();
    for (const request of [CODER_REQUEST, OPS_REQUEST, REVIEWER_REQUEST]) {
      board = dispatchTicket(board, request, 1).dispatch;
    }
    const weeks: DispatchWeekResult[] = [];
    for (let week = 2; week <= 12; week++) {
      const result = tickDispatchWeek(gameAt(week), board, rng);
      board = result.dispatch;
      weeks.push(result);
    }
    return { dispatch: board, weeks, rng: rng.getState() };
  }

  it('replays a whole calendar identically for the same seed', () => {
    const a = playout('release-42');
    const b = playout('release-42');
    expect(a.dispatch).toEqual(b.dispatch);
    expect(a.weeks).toEqual(b.weeks);
    expect(a.rng).toEqual(b.rng);
  });

  it('diverges for a different seed', () => {
    const a = playout('release-42');
    const b = playout('release-43');
    expect(a.weeks).not.toEqual(b.weeks);
  });

  it('reaches a settled board over twelve weeks without exceeding the cap', () => {
    const { dispatch } = playout('release-42');
    expect(dispatch.tickets.length).toBeGreaterThanOrEqual(3);
    for (const ticket of dispatch.tickets) {
      expect(ticket.retry).toBeLessThanOrEqual(RETRY_ESCALATION_THRESHOLD);
      expect(ticket.reports.length).toBeLessThanOrEqual(RETRY_ESCALATION_THRESHOLD);
    }
  });
});
