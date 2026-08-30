/** Preset time window options for the period selector. */
export type Period = '1h' | '3h' | '6h' | '12h' | '24h' | '7d' | '30d' | 'custom';

/** A resolved start/end date pair used to query Firestore. */
export interface DateRange {
  start: Date;
  end: Date;
}

/** Default preset period applied on app load, shared by every screen with a date filter. */
export const DEFAULT_PERIOD: Exclude<Period, 'custom'> = '24h';

/** Computes the concrete start/end dates for a preset period relative to now. */
export function rangeFromPeriod(period: Exclude<Period, 'custom'>): DateRange {
  const end = new Date();
  const start = new Date();
  switch (period) {
    case '1h':  start.setHours(start.getHours() - 1);    break;
    case '3h':  start.setHours(start.getHours() - 3);    break;
    case '6h':  start.setHours(start.getHours() - 6);    break;
    case '12h': start.setHours(start.getHours() - 12);   break;
    case '24h': start.setDate(start.getDate() - 1);       break;
    case '7d':  start.setDate(start.getDate() - 7);       break;
    case '30d': start.setDate(start.getDate() - 30);      break;
  }
  return { start, end };
}
