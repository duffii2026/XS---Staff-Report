export const YEAR_OPTIONS = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032];

/**
 * Normalize a naive MySQL datetime string (stored in UTC) into an explicit UTC
 * ISO instant, e.g. "2026-09-24 02:39:29" -> "2026-09-24T02:39:29Z". Without a
 * timezone marker `new Date(...)` assumes browser-local time and every stored
 * timestamp renders ~7h off for Cambodia (UTC+7) users.
 */
export function toUtcIso(v: string): string {
  if (!v) return '';
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(v)) return v;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[1]}T${m[2]}Z`;
  return String(v);
}

/** Format a stored UTC timestamp as a clock time in Cambodia (Asia/Phnom_Penh, UTC+7). */
export function formatCambodiaClock(v: string): string {
  if (!v) return '';
  const d = v ? new Date(toUtcIso(v)) : new Date(0);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh', hour12: true });
}

/**
 * Parse YYYY-MM-DD safely into local Date without timezone drift
 */
export function parseISODate(isoStr: string): Date {
  if (!isoStr) return new Date();
  const parts = isoStr.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(isoStr);
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculate ISO Week number, year, and quarter from a date string (YYYY-MM-DD) or Date object
 */
export function getWeekNumberFromDate(dateInput: string | Date): {
  weekNumber: number;
  year: number;
  quarter: number;
} {
  const d = typeof dateInput === 'string' ? parseISODate(dateInput) : new Date(dateInput);
  
  // Copy date so don't modify original
  const target = new Date(d.valueOf());
  
  // ISO week date weeks start on Monday, so correct the day number
  const dayNr = (d.getDay() + 6) % 7;
  
  // Set target to Thursday of the current week (ISO-8601 standard defines week by Thursday)
  target.setDate(target.getDate() - dayNr + 3);
  
  // Get first day of that target year
  const firstThursday = target.valueOf();
  const targetFullYear = target.getFullYear();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const year = targetFullYear;
  const quarter = Math.min(4, Math.max(1, Math.ceil(weekNumber / 13)));
  
  return { weekNumber, year, quarter };
}

/**
 * Format a custom start and end date range (e.g. 2026-08-17 to 2026-08-22 -> Aug 17 – Aug 22, 2026)
 */
export function formatDateRange(
  startDateStr?: string,
  endDateStr?: string,
  fallbackWeek?: number,
  fallbackYear: number = 2026
): {
  startDate: string;
  endDate: string;
  formattedRange: string;
  shortRange: string;
} {
  if (startDateStr && endDateStr) {
    const s = parseISODate(startDateStr);
    const e = parseISODate(endDateStr);
    
    const formatShort = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const shortRange = `${formatShort(s)} – ${formatShort(e)}`;
    const formattedRange = `${formatShort(s)} – ${formatShort(e)}, ${s.getFullYear()}`;
    
    return {
      startDate: startDateStr,
      endDate: endDateStr,
      shortRange,
      formattedRange
    };
  }

  if (fallbackWeek !== undefined) {
    const res = getWeekDateRange(fallbackWeek, fallbackYear);
    return {
      startDate: res.startDate,
      endDate: res.endDate,
      shortRange: res.shortRange,
      formattedRange: res.formattedRange
    };
  }

  return {
    startDate: '',
    endDate: '',
    shortRange: '',
    formattedRange: ''
  };
}

export function getWeekDateRange(week: number, year: number = 2026): {
  startDate: string;
  endDate: string;
  formattedRange: string;
  shortRange: string;
  fullLabel: string;
} {
  // ISO-8601 standard: Week 1 is the week with Jan 4th in it
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const dayNr = (dayOfWeek + 6) % 7; // Monday = 0, Sunday = 6
  // Monday of Week 1
  const monWeek1 = new Date(year, 0, 4 - dayNr);

  const start = new Date(monWeek1);
  start.setDate(monWeek1.getDate() + (week - 1) * 7);

  // The reporting week runs Monday to SATURDAY — 6 working days, Sunday off.
  // Kept on the ISO Monday-start grid so week numbering and the Thursday-based
  // month key are unaffected; only the last day of the period moves.
  const end = new Date(start);
  end.setDate(start.getDate() + 5);

  const formatShort = (d: Date) => {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const startISO = formatISODate(start);
  const endISO = formatISODate(end);
  const shortRange = `${formatShort(start)} – ${formatShort(end)}`;
  const formattedRange = `${formatShort(start)} – ${formatShort(end)}, ${start.getFullYear()}`;

  return {
    startDate: startISO,
    endDate: endISO,
    formattedRange,
    shortRange,
    fullLabel: `Week ${week} (${shortRange})`
  };
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Format a datetime-local string (YYYY-MM-DDTHH:mm) or any date string into a
 * readable "real world" form, e.g. 2026-09-25T11:30 -> 2026-09-25 11:30AM.
 */
export function formatDateTimeFriendly(iso: string | undefined | null): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return iso;
  const datePart = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return datePart;
  const h = Number(m[4]);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${datePart} ${hour12}:${m[5]}${ampm}`;
}

export function getTRSubmissionDeadline(endDateStr: string, approvedDeadline?: string): {
  deadlineISO: string;
  formattedDeadline: string;
  shortDeadline: string;
  isExtended: boolean;
  deadlineDate: Date;
} {
  if (approvedDeadline) {
    const appDate = new Date(approvedDeadline);
    if (!isNaN(appDate.getTime())) {
      const formatted = appDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const shortD = appDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return {
        deadlineISO: approvedDeadline,
        formattedDeadline: formatted,
        shortDeadline: shortD,
        isExtended: true,
        deadlineDate: appDate
      };
    }
  }

  // Standard official deadline:
  // Week's cutoff is strictly Monday morning at 11:30 AM following the week's end date.
  const end = parseISODate(endDateStr);
  const deadlineDate = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 11, 30, 0, 0);
  const day = end.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday

  let daysUntilMonday = (1 - day + 7) % 7;
  if (daysUntilMonday === 0) {
    daysUntilMonday = 7;
  }
  deadlineDate.setDate(deadlineDate.getDate() + daysUntilMonday);

  const formattedDeadline = deadlineDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const shortDeadline = deadlineDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return {
    deadlineISO: deadlineDate.toISOString(),
    formattedDeadline,
    shortDeadline,
    isExtended: false,
    deadlineDate
  };
}

/**
 * Get all ISO week numbers that fall into a specific calendar month of a given year
 */
export function getWeeksForMonth(month: number, year: number = 2026): number[] {
  const weeks: number[] = [];
  for (let w = 1; w <= 53; w++) {
    const range = getWeekDateRange(w, year);
    const start = parseISODate(range.startDate);
    // Thursday is the ISO standard determinant of which month a week belongs to
    const thursday = new Date(start.getTime() + 3 * 86400000);
    if (thursday.getFullYear() === year && thursday.getMonth() + 1 === month) {
      weeks.push(w);
    }
  }
  return weeks;
}

/**
 * Stable calendar-month key (e.g. "2026-10") for a reporting period, using the
 * same ISO-Thursday rule as `getWeeksForMonth` / `getMonthInfoForWeek`: a week
 * belongs to the calendar month containing its Thursday.
 *
 * Why this exists: month membership used to be answered by asking whether a
 * report's `weekNumber` appeared in `currentMonthInfo.weeksInMonth`, but that
 * window is computed from the form's LIVE date inputs. Editing the From date
 * reassigns the selected week, which reassigns the month, which could drop an
 * existing report's week out of the window and silently dissolve a monthly-task
 * claim. Deriving the key from the period's OWN start date makes the answer
 * independent of whatever the user is currently typing, so a date correction can
 * never unlock anything.
 */
export function getReportingMonthKey(
  startDate: string | undefined | null,
  weekNumber: number,
  year: number
): string {
  const fallback = getWeekDateRange(weekNumber, year).startDate;
  const parsed = parseISODate(startDate || fallback);
  const anchor = isNaN(parsed.getTime()) ? parseISODate(fallback) : parsed;
  const thursday = new Date(anchor.getTime() + 3 * 86400000);
  return `${thursday.getFullYear()}-${thursday.getMonth() + 1}`;
}

/** ISO-Thursday anchor shared by the reporting-key helpers above/below. */
function reportingWeekAnchor(
  startDate: string | undefined | null,
  weekNumber: number,
  year: number
): Date {
  const fallback = getWeekDateRange(weekNumber, year).startDate;
  const parsed = parseISODate(startDate || fallback);
  const anchor = isNaN(parsed.getTime()) ? parseISODate(fallback) : parsed;
  return new Date(anchor.getTime() + 3 * 86400000);
}

/**
 * The ANNUAL cycle a weekly report belongs to, for Yearly deliverables.
 *
 * Same ISO-Thursday anchoring as getReportingMonthKey (so the outcome can never
 * be changed by editing a date field), but the cycle boundary is shifted: a
 * yearly deliverable on the 2026 cycle expires in the FIRST month of the new
 * year — 31 Jan 2027 — so every week whose Thursday falls in January still
 * belongs to the PREVIOUS year's cycle.
 *
 *   2026 cycle : Feb 2026 ... Dec 2026 ... Jan 2027 (final month, N/A locked)
 *   2027 cycle : Feb 2027 ... Jan 2028
 */
export function getReportingYearlyCycleKey(
  startDate: string | undefined | null,
  weekNumber: number,
  year: number
): string {
  const thursday = reportingWeekAnchor(startDate, weekNumber, year);
  const cycleYear = thursday.getMonth() + 1 === 1 ? thursday.getFullYear() - 1 : thursday.getFullYear();
  return `${cycleYear}`;
}

/**
 * Is this week inside the yearly cycle's FINAL month (the first month of the
 * following calendar year)? When true, an unfulfilled Yearly deliverable may no
 * longer be marked N/A.
 */
export function isFinalMonthOfReportingYear(
  startDate: string | undefined | null,
  weekNumber: number,
  year: number
): boolean {
  return reportingWeekAnchor(startDate, weekNumber, year).getMonth() + 1 === 1;
}

/**
 * Get the month information, week index in that month, and whether this week is the final week of the month
 */
export function getMonthInfoForWeek(
  week: number,
  year: number = 2026,
  customStartDate?: string,
  customEndDate?: string
): {
  month: number; // 1-12
  monthName: string;
  isLastWeekOfMonth: boolean;
  weeksInMonth: number[];
  weekIndexInMonth: number; // 1, 2, 3, 4, 5
  totalWeeksInMonth: number;
} {
  const stdRange = getWeekDateRange(week, year);
  const stdStart = parseISODate(stdRange.startDate);
  const stdEnd = parseISODate(stdRange.endDate);

  let start = stdStart;
  let end = stdEnd;

  if (customStartDate && customEndDate) {
    const parsedStart = parseISODate(customStartDate);
    const parsedEnd = parseISODate(customEndDate);
    if (!isNaN(parsedStart.getTime()) && !isNaN(parsedEnd.getTime())) {
      start = parsedStart;
      end = parsedEnd;
    }
  }

  // Find dominant month for this week using ISO standard Thursday
  const thursday = new Date(stdStart.getTime() + 3 * 86400000);
  const month = thursday.getMonth() + 1;
  const monthYear = thursday.getFullYear();
  const monthName = MONTH_NAMES[month - 1] || `Month ${month}`;
  const weeksInMonth = getWeeksForMonth(month, monthYear);

  // Check last day of the active month
  const lastDayOfMonth = new Date(monthYear, month, 0).getDate();
  const endDay = end.getMonth() + 1 === month ? end.getDate() : (end.getMonth() + 1 > month ? lastDayOfMonth : end.getDate());

  // A week is the last week of the month if:
  // 1. It is the final week in the month's ISO weeks list (e.g. Week 35 in August)
  // 2. OR the period's end date reaches into the final 3 days of the month (e.g. 29, 30, 31)
  const idx = weeksInMonth.indexOf(week);
  const isFinalWeekByList = idx >= 0 && idx === weeksInMonth.length - 1;
  const isNearMonthEnd = endDay >= lastDayOfMonth - 3;

  const isLastWeekOfMonth = isFinalWeekByList || isNearMonthEnd;

  return {
    month,
    monthName,
    isLastWeekOfMonth,
    weeksInMonth,
    weekIndexInMonth: idx >= 0 ? idx + 1 : (endDay <= 7 ? 1 : endDay <= 14 ? 2 : endDay <= 21 ? 3 : 4),
    totalWeeksInMonth: Math.max(weeksInMonth.length, 4)
  };
}

