/**
 * Core engine types. The state shape is frozen by docs/SCOPE_LOCK.md
 * ("State store (stats/flags/week/resources)").
 *
 * Every field is `readonly`: state transitions are pure functions that return a
 * new GameState rather than mutating in place (see state.ts).
 */

/** The four player stats. */
export const STAT_NAMES = ['mandate', 'comprehension', 'scrutiny', 'composure'] as const;
export type StatName = (typeof STAT_NAMES)[number];

/** The three internal factions. */
export const FACTION_NAMES = ['acceleration', 'governance', 'doctrine'] as const;
export type FactionName = (typeof FACTION_NAMES)[number];

/** Stat values, each bounded 0..100. */
export type Stats = Readonly<Record<StatName, number>>;

/** Faction standing, each bounded 0..100. */
export type FactionStanding = Readonly<Record<FactionName, number>>;

/**
 * The complete game state at a point in time.
 *
 * - `stats`            Mandate / Comprehension / Scrutiny / Composure (0-100)
 * - `factions`         Acceleration / Governance / Doctrine standing (0-100)
 * - `drift`            0-100; rises with unverified delegation, lowered by verification
 * - `week`             1-12, the current in-game week
 * - `actionsRemaining` actions left this week (0..ACTIONS_PER_WEEK)
 * - `flags`            set of story/state flags (adversary curation, gates)
 * - `launchReadiness`  0-100, computed from verified work
 */
export interface GameState {
  readonly stats: Stats;
  readonly factions: FactionStanding;
  readonly drift: number;
  readonly week: number;
  readonly actionsRemaining: number;
  readonly flags: ReadonlySet<string>;
  readonly launchReadiness: number;
}
