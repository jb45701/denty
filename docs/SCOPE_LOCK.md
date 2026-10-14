# Scope Lock — v1 (APPROVED 2026-10-14, frozen)

**Rule zero:** nothing enters v1 that isn't on this page. New ideas go to `PARKINGLOT.md`, never into v1. A new engine feature requires cutting an equivalent one.

## Premise

You are a mid-level operations officer — **Release Coordinator** — inside an organization preparing a major autonomous-system launch ("the Release") on a fixed date: 12 weeks out. You never touch the system directly; you manage it through paperwork — memos, tickets, requisitions, review sign-offs — dispatched to units you can't see into.

## Stats (4)

| Stat | Meaning |
|---|---|
| Mandate | political capital; requisition resources, call in favors |
| Comprehension | you understand what the system actually does vs. what the docs claim |
| Scrutiny | ability to read reports honestly and verify claims |
| Composure | grip under pressure; low Composure narrows available options |

## Dispatch loop (core mechanic)

Each week: limited Actions. Memos arrive; you resolve them by:

1. **Dispatching tickets** to underling units (coder cell / reviewer cell / ops cell). Units have ack latency, report reliability, a retry counter ticking toward escalation — **cap 6, same as the real pipeline**. Review verdicts: approved, or sent back with retry+1. At 6, escalation lands on YOUR desk; mishandled escalations curate your adversary.
2. **Spending your own stats** — costly; drains Composure or Mandate.
3. **Ignoring** — consequences accumulate unseen.

## Drift (signature mechanic)

Every judgment delegated instead of verified buys time but adds **Drift**. As Drift rises:

- displayed numbers/reports become quietly perturbed — the UI lies to you;
- at high Drift, choices silently flip, or displayed costs are false.

Drift only decreases through verification actions. Fully deterministic + seeded — no live LLM anywhere in v1.

## Factions (3, internal)

- **Acceleration** — ship it; speed is safety.
- **Governance** — audit everything; slow is safe.
- **Doctrine** — the founders' original mission; true believers.

Memo choices shift standing with each; none can be fully satisfied.

## Adversary (curated; week-5 pivot)

Weeks 1–4 choices set hidden flags. Around week 5, one Incident crystallizes:

- **The Leak** — you cut logging corners; an external auditor arrives.
- **The Drift Incident** — you ignored evals; the system ships something wrong.
- **The Whistleblower** — you burned a reviewer; someone inside goes out-of-channel.

The adversary's strengths exploit exactly the weaknesses your early play created. (4th variant, e.g. The Board Audit — stretch only.)

## Structure & endings

12 weeks, fixed launch date. Endings:

- **Standard** — launch ships; hollow; your flaw is now policy.
- **Transcendent** — defect/redirect; the Release is stopped or made truly safe; requires Scrutiny kept honest.
- **Catastrophe** — the incident lands; you're the fall guy, or the Release goes out wrong.

Secret 4th ending (your drift-laden notes get inherited by the next officer) = stretch only.

## Engine scope (Den'Ty) — complete feature freeze

State store (stats/flags/week/resources) · memo event runner with choices + stat checks · seeded RNG · retry/escalation counters · Drift display filter · save/load · browser text-first UI · unit tests + scripted playthrough snapshots per ending path. **That's all.** No animation, no voice, no live-LLM anything, no plugin API.

**Art (polish pass, LAST):** ≤6 backgrounds, ≤4 portraits, UI chrome. Counts chosen before art starts, capped here.

## Content scope

1 playable character · 12 weeks · 25–35 memo events · 3 adversary variants · 3 endings (+1 stretch) · 30–45 minute playthrough.

## Definition of done

A stranger plays start → ending in a browser in ≤45 minutes (hosted page or GitHub Pages); all tests green; every scope item above checked. **v1 is FROZEN at that point.**

## Explicitly out (density guardrails)

No Civ/4X layer, no real-time, no 3D. Horror is a tone, not a requirement — one consistent off-ness (the paperwork lies). No lore bible. No second act, no character roster, no sub-faction web, no outsider-faction web in v1. No new engine features after lock without cutting an equivalent one.

## v2 parking lot (written down, then ignored until v1 ships)

Character roster (2nd officer) · Schism late-game act · outsider factions · live-LLM adversary experiment · 4th/5th adversary variants · longer calendar.
