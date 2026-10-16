# Den'Ty Jam — Agent Guide (The Release)

Project guide for all agents working in this repo. The orchestrator writes briefs, the coder implements, the reviewer gates. Task state in Den is the coordination source of truth.

## Project facts

- Jam-scale management VN. Engine: small purpose-built TypeScript VN engine ("Den'Ty"), feature-frozen with v1.
- Stack: Vite + TypeScript + Vitest. Node/npm. Build and tests must be green before any task goes to review.
- `docs/SCOPE_LOCK.md` is **authoritative**. Nothing enters v1 that isn't on that page. New ideas go to `PARKINGLOT.md`.
- `docs/DESIGN_BRIEF.md` is the implementation canon; when brief and scope lock disagree, the scope lock wins.
- Den project id: `denty`. Post task notes with `send_message`; change status with `update_task`.

## Module organization

```
src/engine/     pure engine: state store, RNG, event runner, dispatch loop, Drift
src/game/      game content: event data, endings, adversary paths
src/ui/         browser UI (Phase 6; text-first, no animation)
tests/          unit tests + scripted playthrough snapshots
docs/           scope lock, design brief
```

Rules:

- **Engine is pure TypeScript, no DOM dependencies** in `src/engine/` — it must be testable headless.
- One primary type/module per file. Co-locate tests as `foo.spec.ts` next to `foo.ts` under `tests/` is NOT used — put them next to the source.
- No new dependencies without need; the engine should stay small. Content is typed data modules, never executable scripting.

## Coding standards

- TypeScript `strict`. Prefer discriminated unions for event choices/effects.
- **Determinism:** all randomness flows through the seeded RNG module (`src/engine/rng.ts`). `Math.random()` anywhere in `src/` is a review finding.
- Pure functions for state transitions: `(state, action) => newState`. The store clamps stats 0–100 and enforces floors.
- Naming: files `kebab-case.ts`, types PascalCase, exported functions camelCase.

## Testing standards

- Vitest. Every module ships with tests. Test clamping, gating, determinism under fixed seed, retry/escalation triggers (e.g., escalation at exactly 6), and save/load roundtrip once those exist.
- Scripted playthrough snapshots (Phase 6) replay from a fixed seed and assert the end state per ending path.

## Task workflow (required loop)

1. Read the task (`get_task`), set `in_progress` (`update_task`).
2. Implement in small verified slices; commit referencing the task ID.
3. Verify: `npm run build` and `npm test` green.
4. Post a completion note on the task thread (`send_message`, intent `completion_note`): files changed, commands + results, known risks, any canon ambiguities you resolved.
5. Set status to `review`. Blocked? Set `blocked` with evidence, attempted remedies, and a suggested next step — don't stall silently.

## Version control

Conventional commits referencing the Den task ID, e.g. `feat(engine): seeded RNG module (task #2)`. `main` stays deployable; every commit builds and tests green.
