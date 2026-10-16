# Den'Ty Jam — The Release

A jam-scale management visual novel. You are a mid-level **Release Coordinator** inside an organization preparing a major autonomous-system launch ("the Release") on a fixed date. You never touch the system directly — you manage it through paperwork dispatched to units you can't see into.

Built through the Den pipeline (orchestrator → coder → reviewer, retry cap 6) as a portfolio proof of directing agentic workflows to a finished artifact.

- **Engine:** Den'Ty — a small TypeScript VN engine, purpose-built, feature-frozen with v1.
- **Playtime target:** 30–45 minutes, one sitting, in a browser.
- **Scope lock:** `docs/SCOPE_LOCK.md` is authoritative. Nothing enters v1 that isn't on that page.

## Repo layout

```
src/engine/    pure Den'Ty engine: constants, types, state store, seeded RNG
src/game/      game content: event data modules, endings, adversary paths (later phases)
src/ui/        browser text-first UI (later phase)
docs/          scope lock, design brief, event content
```

Unit tests are co-located next to their source as `foo.spec.ts` (per AGENTS.md).

## Commands

```sh
npm install
npm test        # vitest run — engine unit tests
npm run build   # tsc --noEmit && vite build
npm run dev     # vite dev server
```

## Lane pact

The orchestrator (human-directed) writes briefs and acceptance criteria. The coder implements. The reviewer verifies against the brief. When canon is ambiguous, the coder chooses the most game-like path and flags it for review. Escalations land on the human's desk.
