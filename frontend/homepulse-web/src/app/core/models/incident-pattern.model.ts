/** A 2-hour window used to describe peak or stable periods. */
export interface HourRange {
  /** First hour of the window (inclusive, 0–23). */
  startHour: number;
  /** Last hour of the window (exclusive, 2–24). */
  endHour: number;
  /** Number of incidents that started in this window. */
  count: number;
}

/** Weekday aggregation result. */
export interface WeekdayPattern {
  /** 0 = Monday, 6 = Sunday. */
  weekdayIndex: number;
  /** Number of incidents on this weekday. */
  count: number;
}

/** Calendar-day aggregation result. */
export interface DayPattern {
  /** ISO date string, e.g. "2026-06-18". */
  date: string;
  /** Number of incidents on this day. */
  count: number;
  /** Sum of duration_minutes for closed incidents on this day. */
  totalMinutes: number;
}

/**
 * Pre-computed pattern report derived from a set of incidents.
 * Designed to be serialisable so a backend can return the same shape later.
 */
export interface IncidentPattern {
  /** Total number of incidents in the analysed period. */
  totalIncidents: number;
  /** 2-hour bucket with the highest number of incident starts. */
  peakHourRange: HourRange | null;
  /** 2-hour bucket with zero incident starts (first overnight slot found). */
  stableHourRange: HourRange | null;
  /** Day of the week with the highest number of incidents. */
  peakWeekday: WeekdayPattern | null;
  /** Calendar day with the most incidents (ties broken by total offline minutes). */
  worstDay: DayPattern | null;
  /** Mean duration of closed incidents, in minutes. */
  avgDurationMinutes: number | null;
  /** Start date and duration of the single longest closed incident. */
  longestIncident: { date: string; durationMinutes: number } | null;
}
