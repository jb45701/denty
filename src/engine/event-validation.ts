/**
 * Authoring-time validation for memo event data.
 *
 * Content is hand-written TypeScript, so the type system catches most mistakes;
 * these checks catch the ones types cannot express — week ranges outside the
 * calendar, an event with two choices, duplicate ids (which would break the
 * "no duplicate memo" invariant), a stat check with no branch to resolve into.
 *
 * Validation throws `TypeError`/`RangeError` with the offending id in the
 * message. It is called by content tests and may be called by the UI at boot;
 * the runtime path (event-pool.ts, event-runner.ts) does not depend on it.
 */

import { WEEK_MAX, WEEK_START } from './constants';
import { FACTION_NAMES, STAT_NAMES } from './types';
import { UNIT_NAMES, type Effect, type EventChoice, type MemoEvent, type Requirement } from './event-types';

const MIN_CHOICES = 3;
const MAX_CHOICES = 4;
const MIN_MEMO_LINES = 2;
const MAX_MEMO_LINES = 4;

function fail(message: string): never {
  throw new TypeError(`invalid memo event: ${message}`);
}

function assertNonEmptyString(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${what} must be a non-empty string`);
  }
}

function assertInteger(value: unknown, what: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${what} must be an integer`);
  }
}

function validateEffect(effect: Effect, choiceId: string, index: number): void {
  const at = `choice "${choiceId}" effect[${index}]`;

  switch (effect.kind) {
    case 'stat':
      if (!(STAT_NAMES as readonly string[]).includes(effect.stat)) {
        fail(`${at} has unknown stat "${String(effect.stat)}"`);
      }
      if (!Number.isFinite(effect.delta)) fail(`${at} delta must be finite`);
      return;
    case 'faction':
      if (!(FACTION_NAMES as readonly string[]).includes(effect.faction)) {
        fail(`${at} has unknown faction "${String(effect.faction)}"`);
      }
      if (!Number.isFinite(effect.delta)) fail(`${at} delta must be finite`);
      return;
    case 'drift':
      if (!Number.isFinite(effect.delta)) fail(`${at} delta must be finite`);
      return;
    case 'flag':
      assertNonEmptyString(effect.flag, `${at} flag`);
      return;
    case 'spawnTicket':
      if (!(UNIT_NAMES as readonly string[]).includes(effect.unit)) {
        fail(`${at} has unknown unit "${String(effect.unit)}"`);
      }
      assertNonEmptyString(effect.ticketType, `${at} ticketType`);
      return;
    case 'verify':
      if (effect.driftRelief !== undefined && (!Number.isFinite(effect.driftRelief) || effect.driftRelief < 0)) {
        fail(`${at} driftRelief must be a non-negative number`);
      }
      if (
        effect.composureCost !== undefined &&
        (!Number.isFinite(effect.composureCost) || effect.composureCost < 0)
      ) {
        fail(`${at} composureCost must be a non-negative number`);
      }
      if (effect.target !== undefined) assertNonEmptyString(effect.target, `${at} target`);
      return;
    default: {
      const exhaustive: never = effect;
      fail(`${at} is an unknown effect ${JSON.stringify(exhaustive)}`);
    }
  }
}

function validateRequirement(requirement: Requirement, choiceId: string, index: number): void {
  const at = `choice "${choiceId}" requirement[${index}]`;

  switch (requirement.kind) {
    case 'flag':
    case 'noFlag':
      assertNonEmptyString(requirement.flag, `${at} flag`);
      return;
    case 'statAtLeast':
    case 'statAtMost':
      if (!(STAT_NAMES as readonly string[]).includes(requirement.stat)) {
        fail(`${at} has unknown stat "${String(requirement.stat)}"`);
      }
      if (!Number.isFinite(requirement.value)) fail(`${at} value must be finite`);
      return;
    default: {
      const exhaustive: never = requirement;
      fail(`${at} is an unknown requirement ${JSON.stringify(exhaustive)}`);
    }
  }
}

function validateChoice(choice: EventChoice, eventId: string): void {
  assertNonEmptyString(choice.id, `event "${eventId}" choice id`);
  assertNonEmptyString(choice.label, `event "${eventId}" choice "${choice.id}" label`);

  if (choice.actionCost !== undefined) {
    assertInteger(choice.actionCost, `event "${eventId}" choice "${choice.id}" actionCost`);
    if (choice.actionCost < 0) fail(`event "${eventId}" choice "${choice.id}" actionCost must be >= 0`);
  }

  choice.requires?.forEach((requirement, i) => validateRequirement(requirement, choice.id, i));
  choice.effects.effects.forEach((effect, i) => validateEffect(effect, choice.id, i));

  if (choice.check) {
    if (!(STAT_NAMES as readonly string[]).includes(choice.check.stat)) {
      fail(`choice "${choice.id}" check has unknown stat "${String(choice.check.stat)}"`);
    }
    if (!Number.isFinite(choice.check.difficulty)) {
      fail(`choice "${choice.id}" check difficulty must be finite`);
    }
    if (choice.check.difficulty < 0 || choice.check.difficulty > 100) {
      fail(`choice "${choice.id}" check difficulty must be within 0-100`);
    }
    if (choice.check.modifier !== undefined && !Number.isFinite(choice.check.modifier)) {
      fail(`choice "${choice.id}" check modifier must be finite`);
    }
    if (!choice.onSuccess || !choice.onFailure) {
      fail(`choice "${choice.id}" declares a check but is missing onSuccess/onFailure`);
    }
  } else if (choice.onSuccess || choice.onFailure) {
    fail(`choice "${choice.id}" has onSuccess/onFailure but no check to resolve them`);
  }

  choice.onSuccess?.effects.forEach((effect, i) => validateEffect(effect, choice.id, i));
  choice.onFailure?.effects.forEach((effect, i) => validateEffect(effect, choice.id, i));
}

/** Throws when a single event is malformed. */
export function validateEvent(event: MemoEvent): void {
  assertNonEmptyString(event.id, 'event id');
  assertNonEmptyString(event.title, `event "${event.id}" title`);

  assertInteger(event.weekMin, `event "${event.id}" weekMin`);
  assertInteger(event.weekMax, `event "${event.id}" weekMax`);
  if (event.weekMin < WEEK_START || event.weekMin > WEEK_MAX) {
    fail(`event "${event.id}" weekMin must be within ${WEEK_START}-${WEEK_MAX}`);
  }
  if (event.weekMax < WEEK_START || event.weekMax > WEEK_MAX) {
    fail(`event "${event.id}" weekMax must be within ${WEEK_START}-${WEEK_MAX}`);
  }
  if (event.weekMin > event.weekMax) {
    fail(`event "${event.id}" weekMin must be <= weekMax`);
  }

  if (event.memo.length < MIN_MEMO_LINES || event.memo.length > MAX_MEMO_LINES) {
    fail(`event "${event.id}" memo must have ${MIN_MEMO_LINES}-${MAX_MEMO_LINES} lines`);
  }
  event.memo.forEach((line, i) => assertNonEmptyString(line, `event "${event.id}" memo line ${i}`));

  event.requires?.forEach((flag, i) => assertNonEmptyString(flag, `event "${event.id}" requires[${i}]`));
  event.forbids?.forEach((flag, i) => assertNonEmptyString(flag, `event "${event.id}" forbids[${i}]`));

  if (event.choices.length < MIN_CHOICES || event.choices.length > MAX_CHOICES) {
    fail(`event "${event.id}" must have ${MIN_CHOICES}-${MAX_CHOICES} choices`);
  }

  const choiceIds = new Set<string>();
  for (const choice of event.choices) {
    validateChoice(choice, event.id);
    if (choiceIds.has(choice.id)) fail(`event "${event.id}" has duplicate choice id "${choice.id}"`);
    choiceIds.add(choice.id);
  }
}

/**
 * Throws when any event in a pool is malformed, or when two events share an id
 * (which would let the same memo land twice in one playthrough).
 */
export function validateEventPool(pool: readonly MemoEvent[]): void {
  if (!Array.isArray(pool)) fail('event pool must be an array');
  if (pool.length === 0) fail('event pool must not be empty');

  const seen = new Set<string>();
  for (const event of pool) {
    validateEvent(event);
    if (seen.has(event.id)) fail(`duplicate event id "${event.id}" in pool`);
    seen.add(event.id);
  }
}
