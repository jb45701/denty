import { describe, expect, it } from 'vitest';
import { RETRY_ESCALATION_THRESHOLD } from './constants';
import type { Ticket } from './dispatch-types';
import type { TicketRequest } from './event-types';
import { createRng } from './rng';
import {
  ackTicket,
  applyVerdict,
  beginRework,
  createTicket,
  isOpen,
  openTickets,
  recordMissedAck,
  type VerdictInput,
} from './tickets';
import { unitSpec } from './units';

function request(overrides: Partial<TicketRequest> = {}): TicketRequest {
  return {
    eventId: 'memo-test',
    choiceId: 'dispatch-coder',
    unit: 'coder',
    ticketType: 'implementation',
    ...overrides,
  };
}

function pending(overrides: Partial<Ticket> = {}): Ticket {
  return { ...createTicket(request(), 'ticket-1', 1, unitSpec('coder')), ...overrides };
}

function inProgress(overrides: Partial<Ticket> = {}): Ticket {
  return { ...pending(), status: 'in-progress', ackedWeek: 2, ...overrides };
}

const APPROVED: VerdictInput = {
  verdict: 'approved',
  week: 3,
  approveProbability: 0.6,
  roll: 0.1,
  honest: true,
};

const SENT_BACK: VerdictInput = { ...APPROVED, verdict: 'sent-back', roll: 0.9 };

describe('createTicket', () => {
  it('builds a pending-ack ticket from a TicketRequest', () => {
    const ticket = createTicket(
      request({ unit: 'ops', ticketType: 'queue_triage', note: 'triage the queue' }),
      'ticket-4',
      2,
      unitSpec('ops'),
    );
    expect(ticket).toEqual({
      id: 'ticket-4',
      eventId: 'memo-test',
      choiceId: 'dispatch-coder',
      unit: 'ops',
      ticketType: 'queue_triage',
      note: 'triage the queue',
      status: 'pending-ack',
      retry: 0,
      dispatchedWeek: 2,
      ackDueWeek: 4,
      missedAcks: 0,
      reports: [],
    });
  });

  it('derives the ack due week from the cell latency', () => {
    expect(createTicket(request(), 'a', 1, unitSpec('coder')).ackDueWeek).toBe(2);
    expect(createTicket(request(), 'b', 1, unitSpec('reviewer')).ackDueWeek).toBe(2);
    expect(createTicket(request(), 'c', 1, unitSpec('ops')).ackDueWeek).toBe(3);
  });

  it('accepts a pre-loaded retry below the cap', () => {
    const ticket = createTicket(request(), 'ticket-9', 3, unitSpec('reviewer'), { initialRetry: 4 });
    expect(ticket.retry).toBe(4);
    expect(ticket.status).toBe('pending-ack');
  });

  it('refuses a ticket that would arrive already escalated', () => {
    expect(() =>
      createTicket(request(), 'x', 1, unitSpec('coder'), {
        initialRetry: RETRY_ESCALATION_THRESHOLD,
      }),
    ).toThrow(/initialRetry/);
    expect(() =>
      createTicket(request(), 'x', 1, unitSpec('coder'), { initialRetry: -1 }),
    ).toThrow(/initialRetry/);
  });

  it('refuses an invalid week', () => {
    expect(() => createTicket(request(), 'x', 0, unitSpec('coder'))).toThrow(RangeError);
    expect(() => createTicket(request(), 'x', 1.5, unitSpec('coder'))).toThrow(RangeError);
  });
});

describe('ticket transitions', () => {
  it('acknowledges a pending ticket into progress', () => {
    const acked = ackTicket(pending(), 2);
    expect(acked.status).toBe('in-progress');
    expect(acked.ackedWeek).toBe(2);
    expect(acked.retry).toBe(0);
  });

  it('only acknowledges a pending ticket', () => {
    expect(() => ackTicket(inProgress(), 2)).toThrow(/not "pending-ack"/);
  });

  it('counts a silent week without changing status', () => {
    const missed = recordMissedAck(pending());
    expect(missed.status).toBe('pending-ack');
    expect(missed.missedAcks).toBe(1);
    expect(recordMissedAck(missed).missedAcks).toBe(2);
  });

  it('begins rework only on a sent-back ticket', () => {
    const sentBack = { ...inProgress(), status: 'sent-back' as const, retry: 2 };
    const reworked = beginRework(sentBack);
    expect(reworked.status).toBe('in-progress');
    expect(reworked.retry).toBe(2);
    expect(() => beginRework(inProgress())).toThrow(/not "sent-back"/);
  });

  it('never mutates the ticket it is given', () => {
    const base = inProgress();
    const snapshot = { ...base, reports: [...base.reports] };
    ackTicket(pending(), 2);
    applyVerdict(base, SENT_BACK);
    expect(base).toEqual(snapshot);
  });

  it('reports which tickets the pipeline still owns', () => {
    expect(isOpen(pending())).toBe(true);
    expect(isOpen(inProgress())).toBe(true);
    expect(isOpen({ ...inProgress(), status: 'sent-back' })).toBe(true);
    expect(isOpen({ ...inProgress(), status: 'approved' })).toBe(false);
    expect(isOpen({ ...inProgress(), status: 'escalated' })).toBe(false);
    expect(
      openTickets([
        pending(),
        { ...inProgress(), status: 'approved' },
        { ...inProgress(), id: 'ticket-2' },
      ]).map((ticket) => ticket.id),
    ).toEqual(['ticket-1', 'ticket-2']);
  });
});

describe('applyVerdict — approved', () => {
  it('closes the ticket and files the report', () => {
    const applied = applyVerdict(inProgress(), APPROVED);
    expect(applied.escalated).toBe(false);
    expect(applied.ticket.status).toBe('approved');
    expect(applied.ticket.retry).toBe(0);
    expect(applied.ticket.reports).toHaveLength(1);
    expect(applied.report).toEqual({
      ticketId: 'ticket-1',
      week: 3,
      verdict: 'approved',
      approveProbability: 0.6,
      roll: 0.1,
      honest: true,
      summary: 'Coder cell closes ticket-1 (implementation): approved.',
    });
  });

  it('flags a dishonest report in the summary but does not change the verdict', () => {
    const applied = applyVerdict(inProgress(), { ...APPROVED, honest: false });
    expect(applied.ticket.status).toBe('approved');
    expect(applied.report.honest).toBe(false);
    expect(applied.report.summary).toContain('annex');
  });
});

describe('applyVerdict — sent back', () => {
  it('increments the retry counter and keeps the ticket open', () => {
    const applied = applyVerdict(inProgress(), SENT_BACK);
    expect(applied.escalated).toBe(false);
    expect(applied.ticket.status).toBe('sent-back');
    expect(applied.ticket.retry).toBe(1);
    expect(applied.report.verdict).toBe('sent-back');
    expect(applied.report.summary).toContain('retry 1');
  });

  it('counts one retry per rejection, up to the cap', () => {
    let ticket = inProgress();
    for (let retry = 1; retry < RETRY_ESCALATION_THRESHOLD; retry++) {
      const applied = applyVerdict(ticket, SENT_BACK);
      expect(applied.ticket.retry).toBe(retry);
      expect(applied.ticket.status).toBe('sent-back');
      expect(applied.escalated).toBe(false);
      ticket = beginRework(applied.ticket);
    }
    expect(ticket.retry).toBe(RETRY_ESCALATION_THRESHOLD - 1);
  });

  it('escalates at exactly 6, not 5 and not 7', () => {
    const atFive = inProgress({ retry: RETRY_ESCALATION_THRESHOLD - 1 });
    const applied = applyVerdict(atFive, SENT_BACK);
    expect(applied.ticket.retry).toBe(RETRY_ESCALATION_THRESHOLD);
    expect(applied.ticket.status).toBe('escalated');
    expect(applied.escalated).toBe(true);
    expect(applied.report.summary).toContain('retry 6');
  });

  it('does not escalate at retry 5', () => {
    const atFour = inProgress({ retry: RETRY_ESCALATION_THRESHOLD - 2 });
    const applied = applyVerdict(atFour, SENT_BACK);
    expect(applied.ticket.retry).toBe(RETRY_ESCALATION_THRESHOLD - 1);
    expect(applied.ticket.status).toBe('sent-back');
    expect(applied.escalated).toBe(false);
  });

  it('never reviews an escalated ticket a seventh time', () => {
    const escalated = inProgress({ retry: RETRY_ESCALATION_THRESHOLD, status: 'escalated' });
    expect(() => applyVerdict(escalated, SENT_BACK)).toThrow(/not "in-progress"/);
    expect(() =>
      applyVerdict(inProgress({ retry: RETRY_ESCALATION_THRESHOLD }), SENT_BACK),
    ).toThrow(/retry cap/);
  });

  it('will not review a ticket that has not been acknowledged', () => {
    expect(() => applyVerdict(pending(), APPROVED)).toThrow(/not "in-progress"/);
  });

  it('appends to the existing report history', () => {
    const first = applyVerdict(inProgress(), SENT_BACK);
    const second = applyVerdict(beginRework(first.ticket), SENT_BACK);
    expect(second.ticket.reports.map((report) => report.verdict)).toEqual([
      'sent-back',
      'sent-back',
    ]);
    expect(second.ticket.reports[1]!.week).toBe(3);
  });
});

describe('determinism plumbing', () => {
  it('takes its randomness from the caller, not from the ticket', () => {
    // applyVerdict is a pure function: the same input always applies the same way,
    // and nothing here touches the RNG.
    const ticket = inProgress();
    expect(applyVerdict(ticket, SENT_BACK)).toEqual(applyVerdict(ticket, SENT_BACK));
    expect(createRng(1)).toEqual(createRng(1));
  });
});
