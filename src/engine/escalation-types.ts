/**
 * Escalation data model — the crisis memo that lands at retry 6.
 *
 * SCOPE_LOCK: "At 6, escalation lands on YOUR desk; mishandled escalations
 * curate your adversary." DESIGN_BRIEF: "a crisis memo lands on the player's
 * desk with hard choices; mishandling sets adversary flags."
 *
 * An escalation choice is deliberately NOT a MemoEvent choice: it has no stat
 * check and its consequences include adversary curation, which the memo runner
 * knows nothing about. The effect vocabulary is kept small and tagged so a
 * content module can never execute code.
 */

import type { UnitName } from './event-types';
import type { FactionName, StatName } from './types';

/**
 * The hidden flags that decide which adversary crystallises at week 5.
 * These are the same flag names Phase 2 content already sets
 * (logging_shortcut / evals_deferred / burned_reviewer), so the adversary
 * system reads one vocabulary.
 */
export type AdversaryFlag = 'logging_shortcut' | 'evals_deferred' | 'burned_reviewer';

/** One consequence of handling an escalation. */
export type EscalationEffect =
  | { readonly kind: 'stat'; readonly stat: StatName; readonly delta: number }
  | { readonly kind: 'faction'; readonly faction: FactionName; readonly delta: number }
  | { readonly kind: 'drift'; readonly delta: number }
  | { readonly kind: 'readiness'; readonly delta: number }
  | { readonly kind: 'flag'; readonly flag: string };

/** One hard choice on the crisis memo. */
export interface EscalationChoice {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  /** Actions consumed by handling the escalation. */
  readonly actionCost: number;
  /**
   * True for the one path that tells the truth about the failure. Honest
   * handling relieves Drift (DESIGN_BRIEF: -12) and sets no adversary flag.
   */
  readonly honest: boolean;
  /** The adversary flag this choice curates. Every dishonest choice carries one. */
  readonly adversaryFlag?: AdversaryFlag;
  readonly effects: readonly EscalationEffect[];
  readonly log: readonly string[];
}

/** What actually happened when the player picked a choice. */
export interface EscalationResolution {
  readonly choiceId: string;
  readonly week: number;
  readonly honest: boolean;
  readonly adversaryFlags: readonly AdversaryFlag[];
}

/** The crisis memo itself, per ticket, raised at retry 6. */
export interface EscalationMemo {
  readonly id: string;
  readonly ticketId: string;
  readonly week: number;
  readonly ticketType: string;
  readonly unit: UnitName;
  /** Always RETRY_ESCALATION_THRESHOLD; kept so the memo is self-contained. */
  readonly retry: number;
  readonly lines: readonly string[];
  readonly choices: readonly EscalationChoice[];
  readonly resolution?: EscalationResolution;
}
