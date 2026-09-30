/**
 * Client-side mini parser for quick-add lines, e.g.
 *   "A:VM Send updated glass quote — HG due 10/15 !!"
 * Deterministic and forgiving; the server's AI/rule parser is the authority for captures.
 */
import type { Category, Division, ItemDraft, Person } from "@shared/types";
import { PERSONAL_DIVISION_CODE, emptyDraft } from "@shared/types";
import { addDays, parseISODate, todayISO } from "./dates";

export interface QuickParseContext {
  people: Person[];
  divisions: Division[];
  today?: string;
}

const TAG_RE = /^\(?(NB|A|Q|I|D|W)\)?\s*(?::|-|\))\s*/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weekdayOf(iso: string): number {
  return parseISODate(iso)?.getUTCDay() ?? 0;
}

function nextWeekday(today: string, target: number): string {
  const diff = (target - weekdayOf(today) + 7) % 7 || 7;
  return addDays(today, diff);
}

function resolveDueWord(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === "today" || w === "eod") return today;
  if (w === "tomorrow" || w === "tmrw") return addDays(today, 1);
  if (w === "eow") {
    const dow = weekdayOf(today);
    return dow >= 5 || dow === 0 ? nextWeekday(today, 5) : addDays(today, 5 - dow);
  }
  if (w === "next week") return nextWeekday(today, 1);
  const idx = WEEKDAYS.findIndex((d) => w.startsWith(d));
  if (idx >= 0) return nextWeekday(today, idx);
  return null;
}

function resolveDueNumeric(month: string, day: string, year: string | undefined, today: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let y = year ? Number(year.length === 2 ? `20${year}` : year) : Number(today.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, "0");
  let iso = `${y}-${pad(m)}-${pad(d)}`;
  if (!parseISODate(iso)) return null;
  // No year given and the date is far in the past → they meant next year.
  if (!year && iso < addDays(today, -60)) {
    y += 1;
    iso = `${y}-${pad(m)}-${pad(d)}`;
  }
  return iso;
}

export function parseQuickAdd(input: string, ctx: QuickParseContext, defaults: Partial<ItemDraft> = {}): ItemDraft {
  const today = ctx.today ?? todayISO();
  const draft = emptyDraft(defaults);
  let text = input.replace(/\s+/g, " ").trim();
  const initialsSet = new Set(ctx.people.filter((p) => !p.archived).map((p) => p.initials.toUpperCase()));
  const divisionByCode = new Map(ctx.divisions.filter((d) => !d.archived).map((d) => [d.code.toUpperCase(), d.code]));

  // 1. Leading tag, optionally followed by initials ("A:VM", "NB: DK").
  const tag = TAG_RE.exec(text);
  if (tag && tag[1]) {
    draft.category = tag[1].toUpperCase() as Category;
    text = text.slice(tag[0].length);
    const ini = /^([A-Za-z]{2,3})(?=$|[\s:,.-])[\s:,-]*/.exec(text);
    if (ini && ini[1] && initialsSet.has(ini[1].toUpperCase())) {
      draft.ownerInitials = ini[1].toUpperCase();
      text = text.slice(ini[0].length);
    }
  }

  // 2. "@VM" anywhere → owner/target.
  text = text.replace(/(^|\s)@([A-Za-z]{2,3})\b/g, (whole, lead: string, ini: string) => {
    if (initialsSet.has(ini.toUpperCase())) {
      draft.ownerInitials = ini.toUpperCase();
      return lead;
    }
    return whole;
  });

  // 3. Due dates: "due 10/15", "by 10/15/26", "due Friday", "by EOW", "due tomorrow", "next week".
  const numeric = /\b(?:due|by)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i.exec(text);
  if (numeric && numeric[1] && numeric[2]) {
    const iso = resolveDueNumeric(numeric[1], numeric[2], numeric[3], today);
    if (iso) {
      draft.dueDate = iso;
      text = text.replace(numeric[0], " ");
    }
  } else {
    const word = /\b(?:due|by)\s+(today|tomorrow|tmrw|eod|eow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i.exec(text);
    if (word && word[1]) {
      const iso = resolveDueWord(word[1], today);
      if (iso) {
        draft.dueDate = iso;
        text = text.replace(word[0], " ");
      }
    }
  }

  // 4. Priority / parked markers.
  if (/(!!|\burgent\b|\basap\b)/i.test(text)) {
    draft.priority = "High";
    text = text.replace(/(!!+|\burgent\b|\basap\b)/gi, " ");
  }
  if (/\b(someday|parking lot|when we get to it)\b/i.test(text)) {
    draft.status = "Parked";
    text = text.replace(/\b(someday|parking lot|when we get to it)\b/gi, " ");
  }

  // 5. Division code token (or PTD/personal → personal item).
  const tokens = text.split(" ");
  const kept: string[] = [];
  for (const token of tokens) {
    const bare = token.replace(/^[(\[]+|[)\].,;:]+$/g, "");
    const upper = bare.toUpperCase();
    if (upper === PERSONAL_DIVISION_CODE || upper === "PERSONAL") {
      draft.isPersonal = true;
      draft.divisionCode = null;
      continue;
    }
    const code = divisionByCode.get(upper);
    if (code && !draft.isPersonal && bare.length >= 2) {
      draft.divisionCode = code;
      continue;
    }
    kept.push(token);
  }

  // 6. Title = what's left, tidied.
  const title = kept
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^[\s—–-]+|[\s—–-]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  draft.title = title.slice(0, 140);
  return draft;
}
