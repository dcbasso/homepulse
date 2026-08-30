const DIRECTIVE_PATTERN = /%[a-zA-Z%]/g;

/**
 * Renders an approximate preview of a strftime pattern for a given timezone.
 *
 * Display-only helper for the Settings screen — the authoritative formatting
 * happens server-side in Python via `datetime.strftime`. Supports the
 * directives used by the date-format presets: %d, %m, %Y, %y, %H, %I, %M,
 * %S, %p, %Z, %%. Unrecognized directives are left as-is.
 *
 * @param pattern - strftime pattern, e.g. "%d/%m/%Y %H:%M:%S".
 * @param timeZone - IANA timezone name to render the preview in.
 * @param date - Instant to render (defaults to now).
 * @returns The pattern with directives substituted, or the pattern itself if `timeZone` is invalid.
 */
export function formatPreview(pattern: string, timeZone: string, date: Date = new Date()): string {
  let year = '0000';
  let month = '00';
  let day = '00';
  let hour24 = '00';
  let minute = '00';
  let second = '00';
  let hour12 = '00';
  let ampm = 'AM';
  let tzAbbr = '';

  try {
    const map24 = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date).map(p => [p.type, p.value]),
    );
    year = map24['year'] ?? year;
    month = map24['month'] ?? month;
    day = map24['day'] ?? day;
    hour24 = map24['hour'] ?? hour24;
    minute = map24['minute'] ?? minute;
    second = map24['second'] ?? second;

    const map12 = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: true })
        .formatToParts(date).map(p => [p.type, p.value]),
    );
    hour12 = (map12['hour'] ?? hour12).padStart(2, '0');
    ampm = map12['dayPeriod'] ?? ampm;

    tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return pattern;
  }

  const replacements: Record<string, string> = {
    '%d': day,
    '%m': month,
    '%Y': year,
    '%y': year.slice(-2),
    '%H': hour24,
    '%I': hour12,
    '%M': minute,
    '%S': second,
    '%p': ampm,
    '%Z': tzAbbr,
    '%%': '%',
  };

  return pattern.replace(DIRECTIVE_PATTERN, token => replacements[token] ?? token);
}
