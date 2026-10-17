/**
 * Memo event data model.
 *
 * Events are plain TypeScript data (docs/DESIGN_BRIEF.md: "Events are TypeScript
 * data modules (no scripting language)"). There is no evaluator here: every
 * effect is a tagged union member the runner can apply with a `switch`, so an
 * event module can never execute arbitrary code.
 *
 * Shape of one event:
 *
 *   MemoEvent { id, title, week range, requires/forbids flags, memo lines, 3-4 choices }
 *   EventChoice { id, label, action cost, requirements, optional seeded stat check,
 *                 always-applied effect bundle, success/failure bundles }
 *
 * `tickets` are *requests*, not tickets: the dispatch loop (Phase 3) owns the
 * ticket lifecycle. The runner only reports what the player ordered.
 */

import type { FactionName, GameState, StatName } from './types';

/** Units a ticket can be dispatched to (SCOPE_LOCK: coder / reviewer / ops cell). */
export const UNIT_NAMES = ['coder', 'reviewer', 'ops'] as const;
export type UnitName = (typeof UNIT_NAMES)[number];

/** A dispatch ordered by a memo choice; consumed by the Phase 3 ticket system. */
export interface TicketRequest {
  readonly eventId: string;
  readonly choiceId: string;
  readonly unit: UnitName;
  readonly ticketType: string;
  readonly note?: string;
}

/**
 * A seeded stat check, "stat vs difficulty" (DESIGN_BRIEF).
 *
 * Both `difficulty` and `modifier` live on the same 0-100 scale as stats; the
 * runner turns them into a d100 target (see event-runner.ts `checkThreshold`).
 */
export interface StatCheck {
  readonly stat: StatName;
  /** 0-100, same scale as stats. Higher difficulty = harder. */
  readonly difficulty: number;
  /** Situational shift added to the stat before difficulty is subtracted. */
  readonly modifier?: number;
}

/** The recorded outcome of a resolved check — kept for logs and tests. */
export interface CheckResult {
  readonly stat: StatName;
  readonly difficulty: number;
  readonly modifier: number;
  /** d100 roll, 1..100 inclusive. */
  readonly roll: number;
  /** Clamped target: the check passes when `roll <= threshold`. */
  readonly threshold: number;
  readonly success: boolean;
}

/**
 * One typed effect. Everything the frozen scope allows a memo choice to do:
 * stat/faction/Drift deltas, flag sets, a ticket spawn, and a verify action.
 */
export type Effect =
  | { readonly kind: 'stat'; readonly stat: StatName; readonly delta: number }
  | { readonly kind: 'faction'; readonly faction: FactionName; readonly delta: number }
  | { readonly kind: 'drift'; readonly delta: number }
  | { readonly kind: 'flag'; readonly flag: string; readonly value?: boolean }
  | {
      readonly kind: 'spawnTicket';
      readonly unit: UnitName;
      readonly ticketType: string;
      readonly note?: string;
    }
  | {
      readonly kind: 'verify';
      /** What was verified (ticket id, report id, ...) — free text for the log. */
      readonly target?: string;
      /** Drift relief; defaults to VERIFY_DRIFT_RELIEF (-8 per DESIGN_BRIEF). */
      readonly driftRelief?: number;
      /** Composure cost; defaults to VERIFY_COMPOSURE_COST. */
      readonly composureCost?: number;
    };

/** Effects plus the narration lines that describe them. */
export interface EffectBundle {
  readonly effects: readonly Effect[];
  readonly log: readonly string[];
}

/** A precondition on a single choice (flags and stat thresholds). */
export type Requirement =
  | { readonly kind: 'flag'; readonly flag: string }
  | { readonly kind: 'noFlag'; readonly flag: string }
  | { readonly kind: 'statAtLeast'; readonly stat: StatName; readonly value: number }
  | { readonly kind: 'statAtMost'; readonly stat: StatName; readonly value: number };

/** One option on a memo. */
export interface EventChoice {
  readonly id: string;
  /** Imperative label, shown on the button: "Dispatch the coder cell." */
  readonly label: string;
  /** Optional second line of body text. */
  readonly detail?: string;
  /** Actions consumed (default 0). Dispatch / stat-spend / verify cost 1. */
  readonly actionCost?: number;
  /** Choice is unavailable unless every requirement holds. */
  readonly requires?: readonly Requirement[];
  /** Optional seeded check; when present `onSuccess`/`onFailure` are required. */
  readonly check?: StatCheck;
  /** Applied on every outcome, before the check branch. */
  readonly effects: EffectBundle;
  readonly onSuccess?: EffectBundle;
  readonly onFailure?: EffectBundle;
}

/** A memo event. */
export interface MemoEvent {
  readonly id: string;
  readonly title: string;
  /** Inclusive week range the event may surface in (1-12). */
  readonly weekMin: number;
  readonly weekMax: number;
  /** All of these flags must be set. */
  readonly requires?: readonly string[];
  /** None of these flags may be set. */
  readonly forbids?: readonly string[];
  /** Memo body, one string per line (2-4 lines per DESIGN_BRIEF). */
  readonly memo: readonly string[];
  /** 3-4 choices. */
  readonly choices: readonly EventChoice[];
}

/** A verify action performed by a choice, recorded in the resolution. */
export interface VerificationRecord {
  readonly eventId: string;
  readonly choiceId: string;
  readonly target?: string;
  readonly driftRelief: number;
  readonly composureCost: number;
}

/** The pure result of resolving one choice. */
export interface ChoiceResolution {
  readonly eventId: string;
  readonly choiceId: string;
  /** State after action spend + every effect, inputs never mutated. */
  readonly state: GameState;
  /** Present only when the choice declared a check. */
  readonly check?: CheckResult;
  readonly tickets: readonly TicketRequest[];
  readonly verifications: readonly VerificationRecord[];
  readonly actionsSpent: number;
  /** Narration lines: always-applied bundle first, then the check branch. */
  readonly log: readonly string[];
}
