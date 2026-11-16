import { ChecklistFrequency, ChecklistItemStatus } from '../types';

/**
 * Single source of truth for T&R checklist deliverable frequencies.
 *
 * The three frequencies differ in exactly one behavioural axis: whether (and
 * when) staff may mark a deliverable N/A.
 *
 *   Weekly   fixed routine  -> N/A never allowed
 *   Monthly  periodic duty  -> N/A allowed, but LOCKED in the month's final
 *                              week if it was not completed earlier that month.
 *                              The owner schedules it in exactly one week of the
 *                              month; that record claims it and every other week
 *                              shows it locked. The new month releases it.
 *   Anytime  ad-hoc duty    -> N/A always allowed, never locked
 *   Yearly   annual duty    -> Monthly's rules with the cycle unit swapped to a
 *                              YEAR. One submission per cycle; every other week
 *                              of the cycle shows it locked. The cycle's final
 *                              month is the FIRST month of the new calendar
 *                              year (a 2026 cycle expires 31 Jan 2027), where
 *                              N/A is blocked for anything not yet fulfilled.
 *
 * Keeping this here avoids the previous bug class where a new frequency was
 * added to the type but individual `item.category === 'Weekly' ? ... : ...`
 * ternaries silently fell through to the monthly branch.
 */

export const CHECKLIST_FREQUENCIES: ChecklistFrequency[] = ['Weekly', 'Monthly', 'Anytime', 'Yearly'];

/** Default when a category cell is blank or unrecognized. */
export const DEFAULT_FREQUENCY: ChecklistFrequency = 'Weekly';

/** Can staff ever mark this deliverable N/A? */
export function allowsNA(category: ChecklistFrequency | string | undefined | null): boolean {
  return category === 'Monthly' || category === 'Anytime' || category === 'Yearly';
}

/**
 * The status a freshly created deliverable starts in.
 *
 * Weekly duties are fixed routine work, so they start `incomplete` and the owner
 * has to actively tick them off each week.
 *
 * Monthly, Anytime and Yearly duties are NOT expected to be performed every week. The
 * owner schedules a Monthly task into exactly one week of the month, and Anytime
 * duties are on-demand by definition, so in any other week "not performed" is the
 * normal, correct state rather than a failure. Defaulting them to `incomplete`
 * counted them as outstanding every week they were not scheduled, silently
 * depressing Pillar 1 in the very weeks where nothing was expected of the owner.
 * They therefore start as N/A, which Pillar 1 already excludes from both the
 * numerator and the denominator.
 */
export function defaultItemStatus(
  category: ChecklistFrequency | string | undefined | null
): ChecklistItemStatus {
  return allowsNA(category) ? 'na' : 'incomplete';
}

/** Anytime duties are exempt from every month-end lock and reminder. */
export function isAnytime(category: ChecklistFrequency | string | undefined | null): boolean {
  return category === 'Anytime';
}

/**
 * Does this category participate in the monthly completion cycle
 * (fulfilled-earlier-in-month tracking, month-end commit lock, N/A warning)?
 */
export function isMonthlyCycle(category: ChecklistFrequency | string | undefined | null): boolean {
  return category === 'Monthly';
}

/**
 * Does this category participate in the YEARLY completion cycle
 * (one claim per year, expiry in the first month of the new year, N/A lock)?
 */
export function isYearlyCycle(category: ChecklistFrequency | string | undefined | null): boolean {
  return category === 'Yearly';
}

/** Monthly or Yearly: deliverables that can be claimed once per cycle and locked elsewhere. */
export function isPeriodicCycle(category: ChecklistFrequency | string | undefined | null): boolean {
  return isMonthlyCycle(category) || isYearlyCycle(category);
}

/**
 * Map a free-text category cell from an uploaded template to a known frequency.
 *
 * Accepts the canonical labels plus the common variants staff actually type in
 * their CSVs. This is the fix for the reported defect where every non-"month"
 * value — including "Anytime" — was coerced to Weekly.
 */
export function normalizeFrequency(raw: string | null | undefined): ChecklistFrequency {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (!v) return DEFAULT_FREQUENCY;

  // "monthly" / "month" / "monthly task" / "1 month"
  if (/\bmonths?\b/.test(v) || /\bmonthly\b/.test(v)) return 'Monthly';

  // yearly duty — must be checked BEFORE the Anytime synonyms and before the
  // generic /\byearly\b/ match that used to coerce it into 'Anytime'.
  if (/\byearly\b/.test(v) || /\bannual\b/.test(v) || /\bannually\b/.test(v) ||
      /\bper year\b/.test(v) || /\bone year\b/.test(v) || /\b1 year\b/.test(v) ||
      /\bonce a year\b/.test(v) || /\bper annum\b/.test(v) ||
      /\byear tasks?\b/.test(v)) return 'Yearly';

  // "anytime" / "any time" / "any-time" / "as needed" / "ad hoc" / "on demand"
  if (
    /\bany ?times?\b/.test(v) ||
    /\bas needed\b/.test(v) ||
    /\bwhenever\b/.test(v) ||
    /\badhoc\b/.test(v) ||
    /\bad hoc\b/.test(v) ||
    /\bon demand\b/.test(v) ||
    /\boccasional\b/.test(v) ||
    /\bsometimes\b/.test(v) ||
    /\boptional\b/.test(v) ||
    /\bif applicable\b/.test(v)
  ) {
    return 'Anytime';
  }

  if (/\bweeks?\b/.test(v) || /\bweekly\b/.test(v)) return 'Weekly';
  if (/\bdaily\b/.test(v) || /\bquarterly\b/.test(v)) return 'Anytime';

  return DEFAULT_FREQUENCY;
}

/** Tailwind classes for the small category badge. */
export function frequencyBadgeClass(category: ChecklistFrequency | string | undefined | null): string {
  if (category === 'Weekly') return 'bg-blue-100 text-blue-800 border border-blue-200';
  if (category === 'Anytime') return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  if (category === 'Yearly') return 'bg-orange-100 text-orange-800 border border-orange-200';
  return 'bg-purple-100 text-purple-800 border border-purple-200';
}

/** Tailwind classes for the flat (borderless) category badge. */
export function frequencyBadgeClassFlat(category: ChecklistFrequency | string | undefined | null): string {
  if (category === 'Weekly') return 'bg-blue-100 text-blue-800';
  if (category === 'Anytime') return 'bg-emerald-100 text-emerald-800';
  if (category === 'Yearly') return 'bg-orange-100 text-orange-800';
  return 'bg-purple-100 text-purple-800';
}

/**
 * The ANNUAL cycle a "today" belongs to, matching the Week→Year key used for
 * Yearly deliverables (getReportingYearlyCycleKey): the 2026 cycle runs
 * Feb 2026 … Jan 2027, so every date in January still belongs to the PREVIOUS
 * year's cycle, and the new cycle begins on 1 Feb.
 */
export function getCurrentYearlyCycleYear(now: Date): number {
  return now.getMonth() + 1 === 1 ? now.getFullYear() - 1 : now.getFullYear();
}

/** Short label rendered inside the badge. Rendered uppercase by the badge CSS.
 * `cycleYear` is the ANNUAL cycle being viewed (from the selected report period);
 * when omitted it falls back to the cycle "today" belongs to. */
export function frequencyLabel(
  category: ChecklistFrequency | string | undefined | null,
  cycleYear?: number
): string {
  if (category === 'Weekly') return 'Weekly (Fixed)';
  if (category === 'Anytime') return 'Anytime';
  if (category === 'Yearly')
    return `Year Task (Annual-${cycleYear ?? getCurrentYearlyCycleYear(new Date())})`;
  return 'Monthly Task';
}

/** Human-readable explanation used in tooltips. */
export function frequencyRuleHint(category: ChecklistFrequency | string | undefined | null): string {
  if (category === 'Weekly') return 'Fixed weekly tasks must be executed every week (N/A is disabled for Weekly JD items)';
  if (category === 'Anytime') return 'Anytime tasks are executed on demand — you may select N/A at any time, in any week.';
  if (category === 'Yearly') return 'Year Tasks are scheduled in one week of the annual cycle (1 submission per year); every other week of the cycle shows them locked. N/A is available until the cycle ends — it is blocked in the final month (January of the next year), where the task expires on 31 Jan.';
  return 'Monthly tasks may be marked N/A, except in the final week of the month when they are still outstanding. You schedule each monthly task in one week only; other weeks of the month then show it as locked.';
}
