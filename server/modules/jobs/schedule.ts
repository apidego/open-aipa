import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { HttpError } from '../../core/http.js';
export const scheduleSchema = z.object({
  kind: z.enum(['once', 'interval', 'cron']),
  at: z.string().nullable(),
  minutes: z.number().nullable(),
  cron: z.string().nullable(),
  timezone: z.string().max(100),
});
export type Schedule = z.infer<typeof scheduleSchema>;
export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function nextRun(input: Schedule, after = Date.now(), activating = false): number | null {
  const s = scheduleSchema.parse(input);
  if (!validTimezone(s.timezone)) throw new HttpError(400, 'Ungültige Zeitzone.');
  if (s.kind === 'once') {
    if (!s.at || !/(Z|[+-]\d{2}:\d{2})$/.test(s.at) || s.minutes !== null || s.cron !== null)
      throw new HttpError(400, 'Einmaliger Termin benötigt Datum und Uhrzeit mit Zeitzone.');
    const at = Date.parse(s.at);
    if (!Number.isFinite(at)) throw new HttpError(400, 'Ungültiger Termin.');
    if (at <= after) {
      if (activating)
        throw new HttpError(
          400,
          'Der Termin liegt in der Vergangenheit. Bitte den Entwurf neu erstellen.',
        );
      return null;
    }
    return at;
  }
  if (s.kind === 'interval') {
    if (
      !Number.isInteger(s.minutes) ||
      s.minutes! < 1 ||
      s.minutes! > 525600 ||
      s.at !== null ||
      s.cron !== null
    )
      throw new HttpError(400, 'Intervalle müssen zwischen 1 und 525600 Minuten liegen.');
    return after + s.minutes! * 60000;
  }
  if (
    !s.cron ||
    s.cron.length > 100 ||
    s.cron.trim().split(/\s+/).length !== 5 ||
    !/^[\d*,/\-\s]+$/.test(s.cron) ||
    s.at !== null ||
    s.minutes !== null
  )
    throw new HttpError(400, 'Ungültiger wiederkehrender Zeitplan.');
  try {
    return CronExpressionParser.parse(`0 ${s.cron}`, {
      currentDate: after,
      tz: s.timezone,
      strict: true,
    })
      .next()
      .getTime();
  } catch {
    throw new HttpError(400, 'Der wiederkehrende Zeitplan ist ungültig oder mehrdeutig.');
  }
}
