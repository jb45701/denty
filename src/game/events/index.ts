/**
 * Game content: memo events.
 *
 * Content modules are plain typed data (AGENTS.md: "Content is typed data
 * modules, never executable scripting"). Phase 5 grows the pool to the 25-35
 * events in SCOPE_LOCK; everything ships through `starterEventPool` so the UI
 * and the playthrough snapshots have one import to depend on.
 */

export {
  EARLY_MEMOS,
  consistencyCheck,
  evalSampling,
  postIncidentReview,
  reviewerCapacity,
  scopeConfirmation,
} from './early-memos';

import { EARLY_MEMOS } from './early-memos';

/** The event pool the game boots with. */
export const starterEventPool = EARLY_MEMOS;
