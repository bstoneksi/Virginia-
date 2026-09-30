/**
 * Agenda per person / division (docs/SPEC.md §4). Grouping and Markdown come from shared/agenda.ts.
 */
import { Hono } from "hono";
import { agendaToMarkdown, groupForAgenda } from "../../shared/agenda";
import type { Agenda, AgendaSubject, Item } from "../../shared/types";
import { nowISO } from "../db/index";
import type { Repo } from "../db/repo";
import { NotFoundError } from "../lib/errors";
import { boolParam } from "../lib/validate";
import type { RouteDeps } from "./deps";

/** Assemble an Agenda for already-filtered items. Exported for the MCP `get_agenda` tool. */
export function buildAgenda(subject: AgendaSubject, items: Item[], includeDone: boolean): Agenda {
  const generatedAt = nowISO();
  const groups = groupForAgenda(items, { includeDone });
  const markdown = agendaToMarkdown({ subject, groups, generatedAt });
  return { subject, groups, generatedAt, markdown };
}

/** Agenda for a person: items they own; for Brandon (is_me) unowned items count as his too. */
export function personAgenda(repo: Repo, initials: string, includeDone: boolean): Agenda {
  const person = repo.getPersonByInitials(initials);
  if (!person) throw new NotFoundError(`Unknown person: ${initials}`);
  const items = repo.listItems({ ownerInitials: person.initials, includeUnowned: person.isMe, includeDone });
  return buildAgenda({ type: "person", key: person.initials, label: person.fullName }, items, includeDone);
}

export function divisionAgenda(repo: Repo, code: string, includeDone: boolean): Agenda {
  const division = repo.getDivision(code);
  if (!division) throw new NotFoundError(`Unknown division: ${code}`);
  const items = repo.listItems({ divisionCode: division.code, includeDone });
  return buildAgenda({ type: "division", key: division.code, label: division.name }, items, includeDone);
}

export function agendaRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.get("/agenda/person/:initials", (c) => {
    const includeDone = boolParam(c.req.query("includeDone")) ?? false;
    return c.json(personAgenda(repo, c.req.param("initials"), includeDone));
  });

  router.get("/agenda/division/:code", (c) => {
    const includeDone = boolParam(c.req.query("includeDone")) ?? false;
    return c.json(divisionAgenda(repo, c.req.param("code"), includeDone));
  });

  return router;
}
