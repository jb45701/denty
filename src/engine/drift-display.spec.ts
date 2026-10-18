import { describe, expect, it } from 'vitest';
import {
  DRIFT_FLIP_THRESHOLD,
  DRIFT_MAX,
  DRIFT_PERTURBATION_THRESHOLD,
  STAT_MAX,
} from './constants';
import { createDriftDisplay, maxPerturbation, perturbationOffset } from './drift-display';
import type { EventChoice, MemoEvent } from './event-types';
import {
  createInitialState,
  setLaunchReadiness,
  setStat,
} from './state';
import type { GameState } from './types';
import { STAT_NAMES } from './types';

/** A state whose every displayed number is 50, so a clamp never hides an offset. */
function stateAt(drift: number, week = 1): GameState {
  let state: GameState = createInitialState();
  for (const stat of STAT_NAMES) state = setStat(state, stat, 50);
  state = setLaunchReadiness(state, 50);
  return { ...state, drift, week };
}

function costEvent(count: number): MemoEvent {
  const choices: EventChoice[] = Array.from({ length: count }, (_, index) => ({
    id: `choice-${index}`,
    label: `Choice ${index}`,
    actionCost: index % 3,
    effects: { effects: [], log: [] },
  }));
  return {
    id: 'memo-costs',
    title: 'Costs',
    weekMin: 1,
    weekMax: 12,
    memo: ['Every price on this memo is provisional.'],
    choices,
  };
}

/** Every stat and readiness reading for one state. */
function readings(state: GameState): number[] {
  const display = createDriftDisplay('readings');
  return [
    ...STAT_NAMES.map((stat) => display.stat(state, stat).shown),
    display.readiness(state).shown,
  ];
}

describe('maxPerturbation', () => {
  it('is zero below the perturbation threshold', () => {
    for (let drift = 0; drift < DRIFT_PERTURBATION_THRESHOLD; drift++) {
      expect(maxPerturbation(drift)).toBe(0);
    }
  });

  it('is floor(Drift / 10) once the threshold is reached', () => {
    expect(maxPerturbation(40)).toBe(4);
    expect(maxPerturbation(49)).toBe(4);
    expect(maxPerturbation(50)).toBe(5);
    expect(maxPerturbation(100)).toBe(10);
  });

  it('clamps out-of-range Drift', () => {
    expect(maxPerturbation(-20)).toBe(0);
    expect(maxPerturbation(DRIFT_MAX + 50)).toBe(10);
  });
});

describe('displayed numbers — below the threshold', () => {
  it('is the truth: shown equals actual and offset is zero', () => {
    for (let drift = 0; drift < DRIFT_PERTURBATION_THRESHOLD; drift++) {
      const display = createDriftDisplay('honest');
      const state = stateAt(drift, 4);
      for (const stat of STAT_NAMES) {
        expect(display.stat(state, stat)).toEqual({
          actual: 50,
          shown: 50,
          offset: 0,
          perturbed: false,
        });
      }
      expect(display.readiness(state)).toEqual({
        actual: 50,
        shown: 50,
        offset: 0,
        perturbed: false,
      });
    }
  });

  it('ignores the key entirely when there is no perturbation', () => {
    for (const key of ['stat:1:mandate', 'readiness:12', 'anything']) {
      expect(perturbationOffset(39, 'seed', key)).toBe(0);
    }
  });
});

describe('displayed numbers — perturbation bounds', () => {
  it('keeps every offset integral and within Drift / 10', () => {
    for (let drift = DRIFT_PERTURBATION_THRESHOLD; drift <= DRIFT_MAX; drift += 5) {
      const display = createDriftDisplay('bounds');
      for (let week = 1; week <= 12; week++) {
        const state = stateAt(drift, week);
        const numbers = [
          ...STAT_NAMES.map((stat) => display.stat(state, stat)),
          display.readiness(state),
        ];
        for (const number of numbers) {
          expect(Number.isInteger(number.shown)).toBe(true);
          expect(Math.abs(number.shown - number.actual)).toBeLessThanOrEqual(drift / 10);
          expect(number.shown).toBeGreaterThanOrEqual(0);
          expect(number.shown).toBeLessThanOrEqual(STAT_MAX);
          expect(number.offset).toBe(number.shown - number.actual);
          expect(number.perturbed).toBe(number.shown !== number.actual);
        }
      }
    }
  });

  it('lies in both directions at high Drift', () => {
    const offsets: number[] = [];
    for (let week = 1; week <= 12; week++) {
      const display = createDriftDisplay('both-ways');
      const state = stateAt(100, week);
      for (const stat of STAT_NAMES) offsets.push(display.stat(state, stat).offset);
      offsets.push(display.readiness(state).offset);
    }
    expect(offsets.some((offset) => offset > 0)).toBe(true);
    expect(offsets.some((offset) => offset < 0)).toBe(true);
    expect(offsets.some((offset) => offset === 0)).toBe(true);
  });

  it('clamps the shown value into 0..100 instead of showing impossible numbers', () => {
    const display = createDriftDisplay('clamp-high');
    const high = setStat(stateAt(100, 3), 'mandate', 99);
    const low = setStat(stateAt(100, 3), 'mandate', 1);

    for (let week = 1; week <= 12; week++) {
      const highShown = display.stat({ ...high, week }, 'mandate').shown;
      const lowShown = display.stat({ ...low, week }, 'mandate').shown;
      expect(highShown).toBeLessThanOrEqual(STAT_MAX);
      expect(lowShown).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('displayed numbers — determinism', () => {
  it('shows the same lie for the same seed, week and metric', () => {
    const a = createDriftDisplay('playthrough-7');
    const b = createDriftDisplay('playthrough-7');
    for (let week = 1; week <= 12; week++) {
      const state = stateAt(90, week);
      expect(readings(state)).toEqual(readings(state));
      for (const stat of STAT_NAMES) {
        expect(a.stat(state, stat)).toEqual(b.stat(state, stat));
      }
      expect(a.readiness(state)).toEqual(b.readiness(state));
    }
  });

  it('changes the lie for a different seed', () => {
    const a = createDriftDisplay('seed-a');
    const b = createDriftDisplay('seed-b');
    const differences: number[] = [];
    for (let week = 1; week <= 12; week++) {
      const state = stateAt(100, week);
      for (const stat of STAT_NAMES) {
        differences.push(a.stat(state, stat).shown - b.stat(state, stat).shown);
      }
      differences.push(a.readiness(state).shown - b.readiness(state).shown);
    }
    expect(differences.some((difference) => difference !== 0)).toBe(true);
  });

  it('holds a report stable within the week but lets it change next week', () => {
    const display = createDriftDisplay('weekly');
    const monday = stateAt(100, 5);
    const friday = { ...monday, stats: { ...monday.stats, mandate: 60 } };
    expect(display.stat(monday, 'mandate').offset).toBe(
      display.stat(friday, 'mandate').offset,
    );

    const nextWeek = { ...monday, week: 6 };
    const offsets = [display.stat(monday, 'mandate').offset, display.stat(nextWeek, 'mandate').offset];
    expect(offsets.some((offset) => offset !== 0)).toBe(true);
  });
});

describe('displayed action costs', () => {
  it('is truthful below Drift 80', () => {
    const display = createDriftDisplay('costs-honest');
    const event = costEvent(12);
    for (const drift of [0, 40, 79]) {
      const state = stateAt(drift, 2);
      for (const choice of event.choices) {
        expect(display.actionCost(state, event, choice)).toEqual({
          actual: choice.actionCost,
          shown: choice.actionCost,
          misreported: false,
        });
      }
    }
  });

  it('may lie by exactly one action at Drift 80 and above, never negatively', () => {
    const display = createDriftDisplay('costs-lying');
    const event = costEvent(60);
    let truths = 0;
    let lies = 0;

    for (let drift = DRIFT_FLIP_THRESHOLD; drift <= DRIFT_MAX; drift += 10) {
      for (let week = 1; week <= 4; week++) {
        const state = stateAt(drift, week);
        for (const choice of event.choices) {
          const cost = display.actionCost(state, event, choice);
          expect(cost.actual).toBe(choice.actionCost);
          expect(cost.shown).toBeGreaterThanOrEqual(0);
          expect(Math.abs(cost.shown - cost.actual)).toBeLessThanOrEqual(1);
          expect(cost.misreported).toBe(cost.shown !== cost.actual);
          if (cost.misreported) lies++;
          else truths++;
        }
      }
    }

    expect(truths).toBeGreaterThan(0);
    expect(lies).toBeGreaterThan(0);
  });

  it('is deterministic for a seed, week, memo and choice', () => {
    const event = costEvent(20);
    const state = stateAt(100, 7);
    const a = createDriftDisplay('cost-seed');
    const b = createDriftDisplay('cost-seed');
    for (const choice of event.choices) {
      expect(a.actionCost(state, event, choice)).toEqual(b.actionCost(state, event, choice));
    }
  });

  it('can advertise a free choice as costing one action', () => {
    const display = createDriftDisplay('free-lie');
    const event = costEvent(40); // a third of the choices cost 0
    const free = event.choices.filter((choice) => (choice.actionCost ?? 0) === 0);
    const shown = new Set<number>();
    for (let week = 1; week <= 12; week++) {
      for (const choice of free) {
        shown.add(display.actionCost(stateAt(100, week), event, choice).shown);
      }
    }
    expect(shown.has(0)).toBe(true);
    expect(shown.has(1)).toBe(true);
  });
});
