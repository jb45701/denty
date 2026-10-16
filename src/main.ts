/**
 * Browser entry point (Phase 6 fills in the real text-first UI). Phase 1 only
 * proves the engine is wired up and buildable.
 */

import { createInitialState, createRng } from './engine';

const state = createInitialState();
const rng = createRng('the-release');

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  const { stats, factions } = state;
  app.textContent = [
    "Den'Ty — The Release",
    `Week ${state.week} / 12 · actions ${state.actionsRemaining}`,
    `Mandate ${stats.mandate} · Comprehension ${stats.comprehension} · Scrutiny ${stats.scrutiny} · Composure ${stats.composure}`,
    `Acceleration ${factions.acceleration} · Governance ${factions.governance} · Doctrine ${factions.doctrine}`,
    `Drift ${state.drift} · Launch readiness ${state.launchReadiness}%`,
    `Determinism check (seed "the-release"): ${rng.next().toFixed(6)}`,
  ].join('\n');
}
