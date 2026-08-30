import { Injectable } from '@angular/core';
import { Incident } from '../../core/models/incident.model';
import {
  DayPattern,
  HourRange,
  IncidentPattern,
  WeekdayPattern,
} from '../../core/models/incident-pattern.model';

const BUCKET_SIZE = 2;
const TOTAL_BUCKETS = 24 / BUCKET_SIZE;

/**
 * Derives a pattern report from a list of incidents.
 * All computation is pure and runs client-side; the service interface is
 * designed so that a future backend can return the same IncidentPattern shape.
 */
@Injectable({ providedIn: 'root' })
export class IncidentPatternService {

  /**
   * Computes the incident pattern report for the given list.
   *
   * @param incidents - Closed and/or ongoing incidents to analyse.
   * @returns A filled IncidentPattern, or null when the list is empty.
   */
  compute(incidents: Incident[]): IncidentPattern | null {
    if (incidents.length === 0) return null;

    const hourBuckets = new Array<number>(TOTAL_BUCKETS).fill(0);
    const weekdayCounts = new Array<number>(7).fill(0);
    const dayCounts = new Map<string, { count: number; totalMinutes: number }>();

    for (const incident of incidents) {
      const date = incident.started_at.toDate();

      hourBuckets[Math.floor(date.getHours() / BUCKET_SIZE)]++;

      // getDay() → 0=Sun … 6=Sat; remap to 0=Mon … 6=Sun
      weekdayCounts[(date.getDay() + 6) % 7]++;

      const dayKey = date.toISOString().slice(0, 10);
      const prev = dayCounts.get(dayKey) ?? { count: 0, totalMinutes: 0 };
      dayCounts.set(dayKey, {
        count: prev.count + 1,
        totalMinutes: prev.totalMinutes + (incident.duration_minutes ?? 0),
      });
    }

    return {
      totalIncidents: incidents.length,
      peakHourRange: this.peakBucket(hourBuckets),
      stableHourRange: this.stableBucket(hourBuckets),
      peakWeekday: this.peakWeekday(weekdayCounts),
      worstDay: this.worstDay(dayCounts),
      avgDurationMinutes: this.avgDuration(incidents),
      longestIncident: this.longestIncident(incidents),
    };
  }

  private peakBucket(buckets: number[]): HourRange | null {
    const max = Math.max(...buckets);
    if (max === 0) return null;
    const i = buckets.indexOf(max);
    return { startHour: i * BUCKET_SIZE, endHour: (i + 1) * BUCKET_SIZE, count: max };
  }

  private stableBucket(buckets: number[]): HourRange | null {
    const i = buckets.findIndex(c => c === 0);
    if (i === -1) return null;
    return { startHour: i * BUCKET_SIZE, endHour: (i + 1) * BUCKET_SIZE, count: 0 };
  }

  private peakWeekday(counts: number[]): WeekdayPattern | null {
    const max = Math.max(...counts);
    if (max === 0) return null;
    return { weekdayIndex: counts.indexOf(max), count: max };
  }

  private worstDay(dayCounts: Map<string, { count: number; totalMinutes: number }>): DayPattern | null {
    let worst: DayPattern | null = null;
    for (const [date, data] of dayCounts) {
      if (
        !worst ||
        data.count > worst.count ||
        (data.count === worst.count && data.totalMinutes > worst.totalMinutes)
      ) {
        worst = { date, ...data };
      }
    }
    return worst;
  }

  private avgDuration(incidents: Incident[]): number | null {
    const closed = incidents.filter(i => i.duration_minutes !== null);
    if (closed.length === 0) return null;
    const total = closed.reduce((sum, i) => sum + (i.duration_minutes ?? 0), 0);
    return Math.round(total / closed.length);
  }

  private longestIncident(incidents: Incident[]): { date: string; durationMinutes: number } | null {
    const closed = incidents.filter(i => (i.duration_minutes ?? 0) > 0);
    if (closed.length === 0) return null;
    const top = closed.reduce((max, i) => (i.duration_minutes! > max.duration_minutes! ? i : max));
    return {
      date: top.started_at.toDate().toISOString().slice(0, 10),
      durationMinutes: top.duration_minutes!,
    };
  }
}
