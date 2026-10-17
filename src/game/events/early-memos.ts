/**
 * Opening memos — weeks 1-9.
 *
 * This is the reference content set for the Phase 2 runner: five events that
 * together exercise every effect kind (stat, faction, Drift, flag set, flag
 * clear, ticket spawn, verify) and one seeded stat check with both branches.
 * The full 25-35 event pool is authored in Phase 5; these stay because they
 * gate the adversary flags the later content reads.
 *
 * Authoring rules (docs/DESIGN_BRIEF.md):
 *   - 2-4 memo lines, dry institutional voice, no lore;
 *   - 3-4 choices, every choice a real trade;
 *   - flags are lowercase snake_case and never player-visible.
 */

import type { MemoEvent } from '../../engine/event-types';

export const scopeConfirmation: MemoEvent = {
  id: 'memo-scope-confirmation',
  title: 'Scope confirmation — Release parity',
  weekMin: 1,
  weekMax: 3,
  memo: [
    'The Release scope is confirmed as the parity build described in Annex C.',
    'Annex C is not attached. It was attached in an earlier revision of this memo.',
    'This memo supersedes the revision that carried it.',
  ],
  choices: [
    {
      id: 'dispatch-coder',
      label: 'Dispatch the coder cell against Annex C as written.',
      detail: 'They will build what the memo specifies. The memo specifies a document.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'spawnTicket', unit: 'coder', ticketType: 'implementation', note: 'Annex C parity build' },
          { kind: 'faction', faction: 'acceleration', delta: 4 },
          { kind: 'faction', faction: 'governance', delta: -3 },
          { kind: 'drift', delta: 1 },
          { kind: 'flag', flag: 'scope_confirmed' },
        ],
        log: ['The coder cell acknowledges. Their ack is a template.'],
      },
    },
    {
      id: 'challenge-wording',
      label: 'Ask what "parity" means, in writing.',
      detail: 'A Comprehension spend. The answer will also be a memo.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'stat', stat: 'comprehension', delta: -4 },
          { kind: 'stat', stat: 'scrutiny', delta: 2 },
          { kind: 'faction', faction: 'doctrine', delta: 3 },
          { kind: 'flag', flag: 'scope_questioned' },
        ],
        log: ['The request is routed to the office that wrote the definition.'],
      },
    },
    {
      id: 'file-for-record',
      label: 'File for the record. Take no action.',
      actionCost: 0,
      effects: {
        effects: [
          { kind: 'drift', delta: 3 },
          { kind: 'faction', faction: 'governance', delta: -2 },
          { kind: 'flag', flag: 'logging_shortcut' },
        ],
        log: ['Filed. The folder is now the decision.'],
      },
    },
    {
      id: 'verify-annex',
      label: 'Pull the archived spec and compare it yourself.',
      detail: 'Costs an action and your patience. The spec is older than the promise.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'verify', target: 'Annex C (archived)', driftRelief: 8, composureCost: 4 },
          { kind: 'stat', stat: 'scrutiny', delta: 2 },
        ],
        log: ['Three revisions disagree in one table. You now know which table.'],
      },
    },
  ],
};

export const evalSampling: MemoEvent = {
  id: 'memo-eval-sampling',
  title: 'Eval sampling cadence',
  weekMin: 2,
  weekMax: 4,
  memo: [
    'Evals are sampled at 0.4%. The dashboard scores the sample, not the system.',
    'Acceleration asks that the cadence hold. Governance asks for the number it has already been shown.',
    'No action is also a cadence.',
  ],
  choices: [
    {
      id: 'approve-cadence',
      label: 'Approve the reduced cadence.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'flag', flag: 'evals_deferred' },
          { kind: 'drift', delta: 4 },
          { kind: 'faction', faction: 'acceleration', delta: 5 },
          { kind: 'faction', faction: 'governance', delta: -4 },
          { kind: 'stat', stat: 'mandate', delta: 3 },
        ],
        log: ['Approved. The sample size is unchanged, which is the point.'],
      },
    },
    {
      id: 'dispatch-reviewer',
      label: 'Dispatch the reviewer cell to re-sample independently.',
      detail: 'Slower, and it produces a second number.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'spawnTicket', unit: 'reviewer', ticketType: 'eval_resample' },
          { kind: 'drift', delta: 1 },
          { kind: 'faction', faction: 'governance', delta: 4 },
          { kind: 'faction', faction: 'acceleration', delta: -3 },
        ],
        log: ['The reviewer cell accepts the ticket and asks for a definition of "independent".'],
      },
    },
    {
      id: 'absorb-load',
      label: 'Absorb the load in the reviewer cell.',
      detail: 'They are already at retry four.',
      actionCost: 0,
      effects: {
        effects: [
          { kind: 'flag', flag: 'reviewer_pressure' },
          { kind: 'faction', faction: 'acceleration', delta: 3 },
          { kind: 'faction', faction: 'governance', delta: 1 },
          { kind: 'stat', stat: 'composure', delta: -2 },
        ],
        log: ['Routed to the reviewer cell. Their queue does not acknowledge receipts.'],
      },
    },
    {
      id: 'ignore',
      label: 'Ignore the memo.',
      actionCost: 0,
      effects: {
        effects: [
          { kind: 'flag', flag: 'evals_deferred' },
          { kind: 'drift', delta: 5 },
          { kind: 'faction', faction: 'governance', delta: -2 },
        ],
        log: ['The memo remains in the inbox, unread, and therefore unanswered.'],
      },
    },
  ],
};

export const reviewerCapacity: MemoEvent = {
  id: 'memo-reviewer-capacity',
  title: 'Reviewer cell capacity — retry four',
  weekMin: 3,
  weekMax: 6,
  requires: ['reviewer_pressure'],
  memo: [
    'The reviewer cell reports capacity at 100% of a number that has been revised twice.',
    'Retry counter stands at four. The pipeline escalates at six.',
    'This memo is the escalation, arriving early, in the form of a request you can decline.',
  ],
  choices: [
    {
      id: 'push-to-verdict',
      label: 'Push them to verdict. Close the queue.',
      detail: 'One reviewer, one signature, no second reader.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'flag', flag: 'burned_reviewer' },
          { kind: 'drift', delta: 3 },
          { kind: 'stat', stat: 'mandate', delta: 5 },
          { kind: 'stat', stat: 'composure', delta: -2 },
          { kind: 'faction', faction: 'acceleration', delta: 6 },
          { kind: 'faction', faction: 'governance', delta: -6 },
        ],
        log: ['The queue closes. One reviewer signs twice and does not note why.'],
      },
    },
    {
      id: 'escalate-honestly',
      label: 'Escalate honestly. Extend the review window.',
      detail: 'Costs Composure and the schedule. Drift falls.',
      actionCost: 1,
      requires: [{ kind: 'statAtLeast', stat: 'composure', value: 30 }],
      effects: {
        effects: [
          { kind: 'drift', delta: -12 },
          { kind: 'stat', stat: 'composure', delta: -5 },
          { kind: 'faction', faction: 'governance', delta: 5 },
          { kind: 'faction', faction: 'acceleration', delta: -4 },
          { kind: 'flag', flag: 'reviewer_pressure', value: false },
          { kind: 'flag', flag: 'reviewer_pressure_cleared' },
        ],
        log: ['The window extends. The queue is now a schedule, and the schedule is honest.'],
      },
    },
    {
      id: 'dispatch-ops',
      label: 'Dispatch ops to triage the queue.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'spawnTicket', unit: 'ops', ticketType: 'queue_triage' },
          { kind: 'drift', delta: 1 },
          { kind: 'faction', faction: 'governance', delta: 2 },
          { kind: 'faction', faction: 'acceleration', delta: -1 },
        ],
        log: ['Ops accepts. They will triage by who is waiting loudest.'],
      },
    },
    {
      id: 'file-it',
      label: 'File it. Reviewers are a resource.',
      actionCost: 0,
      effects: {
        effects: [
          { kind: 'flag', flag: 'burned_reviewer' },
          { kind: 'drift', delta: 4 },
          { kind: 'stat', stat: 'composure', delta: 1 },
          { kind: 'faction', faction: 'acceleration', delta: 2 },
        ],
        log: ['Filed under capacity. Nothing in the folder is a person.'],
      },
    },
  ],
};

export const consistencyCheck: MemoEvent = {
  id: 'memo-consistency-check',
  title: 'Consistency check — two totals, one system',
  weekMin: 4,
  weekMax: 8,
  memo: [
    'Two reports describe the same subsystem. Their totals differ by 3%.',
    'Neither report mentions the other. Both are signed.',
    'The discrepancy has been open for eleven days, which is not the same as unresolved.',
  ],
  choices: [
    {
      id: 'read-both',
      label: 'Read both reports against each other.',
      detail: 'A Scrutiny check. Nobody will be told you did this.',
      actionCost: 1,
      check: { stat: 'scrutiny', difficulty: 35 },
      effects: {
        effects: [{ kind: 'drift', delta: 1 }],
        log: ['You set the two documents side by side on a desk that is not yours.'],
      },
      onSuccess: {
        effects: [
          { kind: 'stat', stat: 'scrutiny', delta: 3 },
          { kind: 'stat', stat: 'comprehension', delta: 4 },
          { kind: 'drift', delta: -8 },
          { kind: 'flag', flag: 'consistency_confirmed' },
        ],
        log: ['The 3% is a rounding convention applied on one side only. You can explain it now.'],
      },
      onFailure: {
        effects: [
          { kind: 'stat', stat: 'composure', delta: -4 },
          { kind: 'drift', delta: 4 },
          { kind: 'flag', flag: 'consistency_dismissed' },
        ],
        log: ['The numbers refuse each other. You close the folder with them still disagreeing.'],
      },
    },
    {
      id: 'dispatch-reconcile',
      label: 'Dispatch the coder cell to reconcile the totals.',
      detail: 'The totals came out of the deferred-eval run.',
      actionCost: 1,
      requires: [{ kind: 'flag', flag: 'evals_deferred' }],
      effects: {
        effects: [
          { kind: 'spawnTicket', unit: 'coder', ticketType: 'reconciliation', note: '3% delta, two reports' },
          { kind: 'drift', delta: 1 },
          { kind: 'faction', faction: 'governance', delta: 2 },
        ],
        log: ['The coder cell will reconcile the reports to each other, not to the system.'],
      },
    },
    {
      id: 'return-to-reviewer',
      label: 'Return both reports with one question.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'spawnTicket', unit: 'reviewer', ticketType: 'consistency_review' },
          { kind: 'faction', faction: 'governance', delta: 4 },
          { kind: 'faction', faction: 'acceleration', delta: -2 },
          { kind: 'flag', flag: 'consistency_escalated' },
        ],
        log: ['The question is returned unanswered, with a note that it was unclear.'],
      },
    },
    {
      id: 'note-and-move',
      label: 'Note it in your own log and move on.',
      actionCost: 0,
      effects: {
        effects: [
          { kind: 'drift', delta: 2 },
          { kind: 'stat', stat: 'composure', delta: 1 },
          { kind: 'flag', flag: 'consistency_deferred' },
        ],
        log: ['Noted. Your log is not read by anyone who could disagree.'],
      },
    },
  ],
};

export const postIncidentReview: MemoEvent = {
  id: 'memo-post-incident-review',
  title: 'Post-incident review availability',
  weekMin: 6,
  weekMax: 10,
  forbids: ['logging_shortcut'],
  memo: [
    'A defect surfaced in staging. It was caught, which is the good version of this memo.',
    'Because the logs were never shortened, the trace is intact and the review can be honest.',
    'You are being asked to choose what the review is allowed to conclude.',
  ],
  choices: [
    {
      id: 'open-trace',
      label: 'Open the trace. Let the review conclude what it concludes.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'drift', delta: -6 },
          { kind: 'stat', stat: 'scrutiny', delta: 4 },
          { kind: 'faction', faction: 'governance', delta: 6 },
          { kind: 'faction', faction: 'doctrine', delta: 4 },
          { kind: 'faction', faction: 'acceleration', delta: -4 },
          { kind: 'flag', flag: 'incident_review_honest' },
        ],
        log: ['The review opens. Two people who had not spoken this quarter begin to speak.'],
      },
    },
    {
      id: 'scope-to-component',
      label: 'Scope the review to the component, not the process.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'drift', delta: 3 },
          { kind: 'faction', faction: 'acceleration', delta: 4 },
          { kind: 'faction', faction: 'governance', delta: -3 },
          { kind: 'flag', flag: 'incident_review_scoped' },
        ],
        log: ['The review is scoped. The process remains outside its own review.'],
      },
    },
    {
      id: 'ask-doctrine',
      label: 'Ask Doctrine to sit on the review.',
      actionCost: 1,
      effects: {
        effects: [
          { kind: 'stat', stat: 'mandate', delta: -3 },
          { kind: 'faction', faction: 'doctrine', delta: 3 },
          { kind: 'faction', faction: 'acceleration', delta: -2 },
          { kind: 'faction', faction: 'governance', delta: -2 },
          { kind: 'flag', flag: 'doctrine_in_review' },
        ],
        log: ['Doctrine accepts the seat. They bring their own minutes.'],
      },
    },
    {
      id: 'wait-for-result',
      label: 'Let it run. Read the result when it lands.',
      actionCost: 0,
      effects: {
        effects: [
          { kind: 'drift', delta: 2 },
          { kind: 'stat', stat: 'composure', delta: 2 },
          { kind: 'flag', flag: 'incident_review_deferred' },
        ],
        log: ['You will read the result. The result will be a summary.'],
      },
    },
  ],
};

/** The Phase 2 reference pool, in authoring order. */
export const EARLY_MEMOS: readonly MemoEvent[] = [
  scopeConfirmation,
  evalSampling,
  reviewerCapacity,
  consistencyCheck,
  postIncidentReview,
];
