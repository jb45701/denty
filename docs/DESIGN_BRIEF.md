# Design Brief — The Release (implementation canon)

Derived from the approved scope lock. This is the coder's canon; when this and the scope lock disagree, the scope lock wins.

## Tone

Dry institutional menace. Everything is a memo. The horror is one consistent off-ness: the paperwork lies. No gore, no monsters, no lore drops.

## Player state

- Stats 0-100: Mandate, Comprehension, Scrutiny, Composure. Starting values ~35.
- Faction standing: Acceleration, Governance, Doctrine (0-100, start 50).
- Drift 0-100 (starts 0). Hidden from direct display; player infers it from the UI's honesty.
- Week counter 1-12. Actions per week: 3 (dispatch counts, stat-spends cost 1, verification costs 1).
- Ticket state per dispatch: pending-ack -> in-progress -> verdict (approved / sent-back retry+1) -> escalation at retry 6.
- Deadlines: launch occurs at end of week 12. Launch readiness score computed from verified work.

## Dispatch loop (turn structure)

1. Week opens: 2-3 memos land in the inbox (from the 25-35 event pool, gated by week + flags).
2. Each memo presents 3-4 choices. Choice types:
   - DISPATCH to a unit (coder/reviewer/ops): spawns a ticket. Ack arrives next week (or silence — reliability roll vs seeded RNG). Report follows; may be dishonest (reliability + Drift).
   - VERIFY (costs an action + Composure): reveals the true state of a ticket/report; reduces Drift.
   - SPEND stats (Mandate to requisition, Comprehension to challenge a claim).
   - IGNORE: memo consequences accumulate unseen.
3. Review verdicts: reviewer cell returns approved or sent-back (retry+1) per seeded probabilities modulated by ticket type and Drift.
4. Escalation at retry 6: a crisis memo lands on the player's desk with hard choices; mishandling sets adversary flags.

## Drift rules

- +Drift on every unverified delegation outcome (small), every ignored memo (medium), every accepted dishonest report (large).
- Displayed values perturbed once Drift >= 40: shown = true + seeded offset in [-Drift/10, +Drift/10], rounded.
- At Drift >= 80: one choice per memo may silently flip its effect at resolution; displayed costs may be false.
- Drift reduced by: successful VERIFY (-8), escalation handled honestly (-12), week with zero dispatches (never realistically optimal).
- Scrutiny check at report time: honest reading catches perturbation (shows both numbers, "the report disagrees with itself").

## Adversary system

Weeks 1-4 choices set hidden flags (logging shortcuts, ignored evals, burned reviewer). Week 5: incident memo crystallizes the adversary (Leak / Drift Incident / Whistleblower). Adversary applies weekly pressure from week 5 on: escalating memos that exploit the flags set. Endings gate on adversary resolution + launch readiness + Drift.

## Endings (gates)

- Standard: launch ships, readiness >= 60, adversary unresolved-or-bought-off.
- Transcendent: readiness >= 60 AND adversary resolved via Scrutiny/Comprehension path AND Drift <= 40.
- Catastrophic: readiness < 60, OR adversary triggers the incident at week 12 unresolved, OR Drift >= 90.
- (Stretch) Secret: specific flag set + Drift 50-80 + standard launch.

## Event authoring format

Events are TypeScript data modules (no scripting language): id, week range, requires/forbids flags, memo text (2-4 lines), choices with effects. Authored by orchestrator-side, implemented by coder. Deterministic; RNG only through the seeded engine.
