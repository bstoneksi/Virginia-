/**
 * Timezone helpers shared by the server and the client.
 *
 * The owner's timezone comes from assistant.config.json (`owner.timezone`): the server reads it from
 * `config.assistant`, the client from `/api/bootstrap` (`assistant.timezone`). `DEFAULT_TIMEZONE` is
 * the documented fallback — the first instance's America/Detroit — used wherever no timezone was
 * threaded through yet.
 */

export const DEFAULT_TIMEZONE = "America/Detroit";

/** True when `Intl` accepts `tz` as a timeZone (an IANA name such as "America/Detroit", or "UTC"). */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== "string" || tz.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(tz, formatter);
  }
  return formatter;
}

/** Calendar date (YYYY-MM-DD) of `date` in `tz`. */
export function dateISOInTZ(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const parts = dateFormatter(tz).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
