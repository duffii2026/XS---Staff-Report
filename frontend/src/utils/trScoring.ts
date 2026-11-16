import { SubmittedChecklistItem } from '../types';

/**
 * Single source of truth for T&R Pillar 1 (Checklist Completion).
 *
 * The Scoring Policy partitions a weekly T&R report into three pillars:
 *
 *   Pillar 1  Checklist Completion  max 50 pts  (this module)
 *   Pillar 2  Submission Timeliness max 20 pts
 *   Pillar 3  Superior Quality      max 30 pts
 *                                  ------
 *                            total 100 pts
 *
 * Pillar 1 is a straight average over the week's deliverables scaled to 50
 * points, with a fairness rule: an item the staff legitimately marked N/A is
 * excluded from BOTH the numerator and the denominator, so it can neither
 * earn nor cost points.
 *
 * This module exists because the same calculation was previously inlined at
 * four call sites that had drifted apart — most importantly they disagreed on
 * the all-N/A edge case, and the revision path stored a 0-100 percentage into
 * the 0-50 `completionScore` field.
 */

export const TR_PILLAR1_MAX = 50;
export const TR_PILLAR2_MAX = 20;
export const TR_PILLAR3_MAX = 30;

/** Pillars 1 + 2 — the maximum base score before the superior grades Pillar 3. */
export const TR_BASE_MAX = TR_PILLAR1_MAX + TR_PILLAR2_MAX + TR_PILLAR3_MAX; // 70

export interface Pillar1Result {
  /** 0 - 50 pts. */
  score: number;
  /** 0 - 100, the raw completion percentage across applicable items. */
  percent: number;
  /** Every deliverable on the checklist, N/A and locked included. */
  total: number;
  /** Deliverables marked completed. */
  completed: number;
  /** Deliverables marked N/A (excluded from scoring). */
  na: number;
  /**
   * Deliverables locked by an earlier week of the same month cycle (a Monthly task
   * already fulfilled in, say, W40 while this report covers W41). Excluded from
   * scoring exactly like N/A — the work already happened and was credited then, so
   * leaving it in the denominator would penalise the later week for a task it is
   * not allowed to perform.
   */
  locked: number;
  /** Deliverables that actually count toward the score: total - na - locked. */
  applicable: number;
}

/**
 * `status` is authoritative when present; `completed` is the legacy flag kept
 * for rows persisted before the three-state control existed.
 */
export function isChecklistItemDone(item: SubmittedChecklistItem): boolean {
  return item.status ? item.status === 'completed' : item.completed;
}

/** N/A is opt-in per item and only ever set via the three-state control. */
export function isChecklistItemNA(item: SubmittedChecklistItem): boolean {
  return item.status === 'na';
}

/**
 * Pillar 1 — average checklist completion, scaled to 50 pts.
 *
 * `lockedItemIds` names deliverables that are settled elsewhere in the month cycle
 * and therefore must not affect this report's score. They are removed from the
 * denominator but still counted in `total` so the checklist keeps showing them.
 *
 * Edge cases:
 *   - Every item N/A or locked -> 50/50. Nothing was left outstanding, so the
 *     staff earns full credit on this pillar.
 *   - No items at all -> 0/50. There is no evidence of work to average.
 *   - Partial N/A / locked -> those leave the denominator entirely, so the
 *     remaining applicable items carry the full 50-point weight.
 */
export function computePillar1(
  items: SubmittedChecklistItem[] | undefined | null,
  lockedItemIds?: ReadonlySet<string> | null
): Pillar1Result {
  const list = items ?? [];
  const total = list.length;
  const isLocked = (it: SubmittedChecklistItem) =>
    !!lockedItemIds && lockedItemIds.has(it.itemId) && lockedItemIds.size > 0;
  const na = list.filter(it => isChecklistItemNA(it) && !isLocked(it)).length;
  const locked = list.filter(it => isLocked(it) && !isChecklistItemNA(it)).length;
  const completed = list.filter(it => isChecklistItemDone(it) && !isChecklistItemNA(it) && !isLocked(it)).length;
  const applicable = total - na - locked;

  if (applicable > 0) {
    return {
      // Scaled straight from the ratio rather than from `percent`, so the
      // result cannot drift by a point from a double rounding of the
      // intermediate integer percentage.
      score: Math.round((completed / applicable) * TR_PILLAR1_MAX),
      percent: Math.round((completed / applicable) * 100),
      total,
      completed,
      na,
      locked,
      applicable,
    };
  }

  const nothingOutstanding = total > 0;
  return {
    score: nothingOutstanding ? TR_PILLAR1_MAX : 0,
    percent: nothingOutstanding ? 100 : 0,
    total,
    completed,
    na,
    locked,
    applicable,
  };
}

/** Clamp a Pillar 1 value into its legal 0-50 range. */
export function clampPillar1(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(TR_PILLAR1_MAX, Math.max(0, Math.round(score)));
}

/** Clamp a Pillar 2 value into its legal 0-20 range. */
export function clampPillar2(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(TR_PILLAR2_MAX, Math.max(0, Math.round(score)));
}

/** Clamp the Pillar 1 + Pillar 2 base into its legal 0-70 range. */
export function clampBase(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(TR_BASE_MAX, Math.max(0, Math.round(score)));
}
