/**
 * The timezone every date in the UI is shown in: the owner's timezone from /api/bootstrap
 * (`assistant.timezone`, set by BootstrapProvider as soon as it loads), America/Detroit until then.
 * Kept in a module variable so the helpers in lib/dates.ts stay plain functions.
 */
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@shared/timezone";

let current = DEFAULT_TIMEZONE;

export function displayTimezone(): string {
  return current;
}

/** Called with the bootstrap's `assistant.timezone`; anything Intl rejects falls back to the default. */
export function setDisplayTimezone(tz: string | null | undefined): void {
  current = tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}
