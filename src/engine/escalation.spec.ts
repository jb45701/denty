import { describe, expect, it } from 'vitest';
import { ESCALATION_HONEST_DRIFT_RELIEF, RETRY_ESCALATION_THRESHOLD } from './constants';
import type { DispatchState, Ticket } from './dispatch-types';
import { createDispatchState } from './dispatch-types';
import {
  ADVERSARY_FLAGS,
  buildEscalationMemo,
  escalationIdFor,
  isAdversaryFlag,
  openEscalations,
  resolveEscalation,
} from './escalation';
import type { EscalationMemo } from './escalation-types';
import type { TicketRequest } from './event-types';
import { createInitialState, setDrift } from './state';
import { createTicket } from './tickets';
import { unitSpec } from './units';

function request(overrides: Partial<TicketRequest> = {}): TicketRequest {
  return {
    eventId: 'memo-reviewer-capacity',
    choiceId: 'dispatch-ops',
    unit: 'ops',
    ticketType: 'implementation',
    ...overrides,
  };
}

function escalatedTicket(overrides: Partial<Ticket> = {}): Ticket {
  const base = createTicket(request(), 'ticket-7', 1, unitSpec('ops'), { initialRetry: 5 });
  return { ...base, status: 'escalated', retry: RETRY_ESCALATION_THRESHOLD, ...overrides };
}

function board(ticket: Ticket = escalatedTicket()): { dispatch: DispatchState; memo: EscalationMemo } {
  const memo = buildEscalationMemo(ticket, 4);
  return {
    dispatch: { ...createDispatchState(), tickets: [ticket], escalations: [memo] },
    memo,
  };
}

describe('buildEscalationMemo', () => {
  it('builds one crisis memo per escalated ticket', () => {
    const memo = buildEscalationMemo(escalatedTicket(), 4);
    expect(memo.id).toBe('escalation-ticket-7');
    expect(escalationIdFor('ticket-7')).toBe('escalation-ticket-7');
    expect(memo.ticketId).toBe('ticket-7');
    expect(memo.ticketType).toBe('implementation');
    expect(memo.unit).toBe('ops');
    expect(memo.week).toBe(4);
    expect(memo.retry).toBe(RETRY_ESCALATION_THRESHOLD);
    expect(memo.resolution).toBeUndefined();
  });

  it('states the cap in plain language and names the ticket', () => {
    const memo = buildEscalationMemo(escalatedTicket(), 4);
    expect(memo.lines).toHaveLength(3);
    expect(memo.lines[0]).toContain('ticket-7');
    expect(memo.lines[0]).toContain('Ops cell');
    expect(memo.lines[0]).toContain(`${RETRY_ESCALATION_THRESHOLD} times`);
    expect(memo.lines.join(' ')).toContain('The cap is six');
    expect(memo.lines.join(' ')).toContain('There is no seventh review');
  });

  it('offers four hard choices, exactly one of them honest', () => {
    const memo = buildEscalationMemo(escalatedTicket(), 4);
    expect(memo.choices).toHaveLength(4);
    expect(memo.choices.filter((choice) => choice.honest)).toHaveLength(1);
    for (const choice of memo.choices) {
      expect(choice.actionCost).toBe(1);
      expect(choice.effects.length).toBeGreaterThan(0);
      expect(choice.log.length).toBeGreaterThan(0);
    }
    expect(memo.choices.map((choice) => choice.id)).toEqual([
      'accept-as-is',
      'strike-retries',
      'blame-reviewer',
      'own-it',
    ]);
  });

  it('curates an adversary on every dishonest path', () => {
    const memo = buildEscalationMemo(escalatedTicket(), 4);
    const dishonest = memo.choices.filter((choice) => !choice.honest);
    expect(dishonest).toHaveLength(3);
    for (const choice of dishonest) {
      expect(choice.adversaryFlag).toBeDefined();
      expect(isAdversaryFlag(choice.adversaryFlag!)).toBe(true);
    }
    expect(new Set(dishonest.map((choice) => choice.adversaryFlag))).toEqual(
      new Set(ADVERSARY_FLAGS),
    );
    const honest = memo.choices.find((choice) => choice.honest)!;
    expect(honest.adversaryFlag).toBeUndefined();
  });

  it('refuses to raise an escalation before the cap', () => {
    const early = { ...escalatedTicket(), retry: 5, status: 'sent-back' as const };
    expect(() => buildEscalationMemo(early, 4)).toThrow(/needs 6/);
  });
});

describe('resolveEscalation — honest handling', () => {
  it('relieves canon Drift, costs composure and records the resolution', () => {
    const { dispatch, memo } = board();
    const game = setDrift(createInitialState(), 40);
    const result = resolveEscalation(game, dispatch, memo.id, 'own-it', 5);

    expect(result.game.drift).toBe(40 - ESCALATION_HONEST_DRIFT_RELIEF);
    expect(result.game.stats.composure).toBe(30);
    expect(result.game.stats.mandate).toBe(32);
    expect(result.game.actionsRemaining).toBe(2);
    expect(result.game.flags.has('escalation_owned')).toBe(true);
    expect(result.game.factions.governance).toBe(54);
    expect(result.game.factions.acceleration).toBe(46);

    expect(result.resolution).toEqual({
      choiceId: 'own-it',
      week: 5,
      honest: true,
      adversaryFlags: [],
    });
    expect(result.dispatch.escalations[0]!.resolution).toEqual(result.resolution);
    expect(openEscalations(result.dispatch)).toEqual([]);
    expect(result.log.at(-1)).toBe('Handled honestly. The record is longer, and true.');
  });

  it('clamps Drift relief at zero and readiness at zero', () => {
    const { dispatch, memo } = board();
    const game = setDrift(createInitialState(), 5);
    const result = resolveEscalation(game, dispatch, memo.id, 'own-it', 5);
    expect(result.game.drift).toBe(0);
    expect(result.game.launchReadiness).toBe(0);
  });
});

describe('resolveEscalation — mishandling', () => {
  it('accepting the work ships it and defers evals', () => {
    const { dispatch, memo } = board();
    const result = resolveEscalation(createInitialState(), dispatch, memo.id, 'accept-as-is', 5);
    expect(result.game.drift).toBe(6);
    expect(result.game.launchReadiness).toBe(5);
    expect(result.game.stats.composure).toBe(32);
    expect(result.game.flags.has('evals_deferred')).toBe(true);
    expect(result.resolution.adversaryFlags).toEqual(['evals_deferred']);
    expect(result.resolution.honest).toBe(false);
    expect(result.log.at(-1)).toContain('evals_deferred');
  });

  it('striking the retries takes the logging shortcut', () => {
    const { dispatch, memo } = board();
    const result = resolveEscalation(createInitialState(), dispatch, memo.id, 'strike-retries', 5);
    expect(result.game.flags.has('logging_shortcut')).toBe(true);
    expect(result.game.stats.mandate).toBe(31);
    expect(result.resolution.adversaryFlags).toEqual(['logging_shortcut']);
  });

  it('blaming the reviewer burns the reviewer', () => {
    const { dispatch, memo } = board();
    const result = resolveEscalation(createInitialState(), dispatch, memo.id, 'blame-reviewer', 5);
    expect(result.game.flags.has('burned_reviewer')).toBe(true);
    expect(result.game.stats.mandate).toBe(38);
    expect(result.resolution.adversaryFlags).toEqual(['burned_reviewer']);
  });

  it('never leaves a mishandled escalation without an adversary flag', () => {
    for (const choiceId of ['accept-as-is', 'strike-retries', 'blame-reviewer']) {
      const { dispatch, memo } = board();
      const result = resolveEscalation(createInitialState(), dispatch, memo.id, choiceId, 5);
      expect(result.resolution.adversaryFlags).toHaveLength(1);
      expect(result.game.flags.has(result.resolution.adversaryFlags[0]!)).toBe(true);
    }
  });
});

describe('resolveEscalation — guards', () => {
  it('rejects an unknown escalation id', () => {
    const { dispatch } = board();
    expect(() => resolveEscalation(createInitialState(), dispatch, 'nope', 'own-it', 5)).toThrow(
      RangeError,
    );
  });

  it('rejects an unknown choice id', () => {
    const { dispatch, memo } = board();
    expect(() => resolveEscalation(createInitialState(), dispatch, memo.id, 'nope', 5)).toThrow(
      /no choice/,
    );
  });

  it('resolves an escalation only once', () => {
    const { dispatch, memo } = board();
    const once = resolveEscalation(createInitialState(), dispatch, memo.id, 'own-it', 5);
    expect(() =>
      resolveEscalation(once.game, once.dispatch, memo.id, 'accept-as-is', 5),
    ).toThrow(/already resolved/);
  });

  it('requires an action to handle the crisis', () => {
    const { dispatch, memo } = board();
    const broke = { ...createInitialState(), actionsRemaining: 0 };
    expect(() => resolveEscalation(broke, dispatch, memo.id, 'own-it', 5)).toThrow(/costs 1 action/);
  });

  it('does not mutate the game state or the board', () => {
    const { dispatch, memo } = board();
    const game = setDrift(createInitialState(), 20);
    const gameSnapshot = { ...game, stats: { ...game.stats }, flags: new Set(game.flags) };
    resolveEscalation(game, dispatch, memo.id, 'accept-as-is', 5);
    expect(game).toEqual(gameSnapshot);
    expect(dispatch.escalations[0]!.resolution).toBeUndefined();
    expect(openEscalations(dispatch)).toHaveLength(1);
  });
});
