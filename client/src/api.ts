/**
 * Typed fetch wrapper over the Virginia API (docs/SPEC.md §4).
 * - always `credentials: "include"`
 * - JSON errors `{ error, details? }` surface as a thrown `ApiError` with the HTTP status
 * - 401 redirects to /login (except when already there)
 */
import type {
  Agenda,
  ApiError as ApiErrorBody,
  Bootstrap,
  Brief,
  BriefKind,
  Capture,
  CaptureStatus,
  CaptureSummary,
  Division,
  ImportCommitResult,
  ImportPreview,
  ImportRow,
  Initiative,
  InitiativeStatus,
  Item,
  ItemDraft,
  ItemEvent,
  ItemFilters,
  Person,
  Proposal,
  ReorderRequest,
  SearchResult,
  Status,
  TodayView,
} from "@shared/types";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// --- response / request shapes not covered by shared/types -----------------

export interface ItemDetail extends Item {
  events: ItemEvent[];
  capture?: CaptureSummary | null;
}
export type ItemPatch = Partial<ItemDraft> & { status?: Status; rank?: number };
export type PersonInput = Omit<Person, "id">;
export type PersonPatch = Partial<PersonInput>;
export type DivisionInput = Division;
export type DivisionPatch = Partial<Omit<Division, "code">>;
export interface InitiativeInput {
  name: string;
  status?: InitiativeStatus;
}
export type InitiativePatch = Partial<InitiativeInput>;
export interface AcceptResult {
  proposal: Proposal;
  item: Item;
}
export interface CaptureCreateInput {
  text?: string;
  context?: string;
  defaultDivisionCode?: string | null;
  title?: string;
  files?: File[];
}
export interface BriefInput {
  kind: BriefKind;
  title: string;
  bodyMd: string;
}

// --- core -------------------------------------------------------------------

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "" || value === false) continue;
      params.set(key, value === true ? "1" : String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, body, credentials: "include", signal: opts.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "Network error — check your connection and try again");
  }

  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError(401, "Not signed in");
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const parsed = JSON.parse(text) as Partial<ApiErrorBody>;
      if (typeof parsed.error === "string" && parsed.error) message = parsed.error;
      details = parsed.details;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    throw new ApiError(res.status, message, details);
  }
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

function itemQuery(filters: ItemFilters): Query {
  return {
    status: filters.status?.join(","),
    category: filters.category?.join(","),
    division: filters.divisionCode,
    owner: filters.ownerInitials,
    personal: filters.personal,
    includeDone: filters.includeDone,
    initiative: filters.initiativeId,
    q: filters.q,
  };
}

// --- endpoints --------------------------------------------------------------

export const api = {
  auth: {
    login: (password: string) => request<void>("POST", "/api/auth/login", { body: { password } }),
    logout: () => request<void>("POST", "/api/auth/logout"),
    me: () => request<{ authenticated: boolean }>("GET", "/api/auth/me"),
  },
  bootstrap: (signal?: AbortSignal) => request<Bootstrap>("GET", "/api/bootstrap", { signal }),
  health: () => request<{ ok: boolean; version: string }>("GET", "/api/health"),

  items: {
    list: (filters: ItemFilters = {}, signal?: AbortSignal) =>
      request<Item[]>("GET", "/api/items", { query: itemQuery(filters), signal }),
    get: (id: string) => request<ItemDetail>("GET", `/api/items/${encodeURIComponent(id)}`),
    create: (draft: ItemDraft) => request<Item>("POST", "/api/items", { body: draft }),
    update: (id: string, patch: ItemPatch) => request<Item>("PATCH", `/api/items/${encodeURIComponent(id)}`, { body: patch }),
    remove: (id: string) => request<void>("DELETE", `/api/items/${encodeURIComponent(id)}`),
    reorder: (req: ReorderRequest) => request<void>("POST", "/api/items/reorder", { body: req }),
    comment: (id: string, text: string) =>
      request<ItemEvent>("POST", `/api/items/${encodeURIComponent(id)}/comments`, { body: { text } }),
  },

  agenda: {
    person: (initials: string, includeDone = false) =>
      request<Agenda>("GET", `/api/agenda/person/${encodeURIComponent(initials)}`, { query: { includeDone } }),
    division: (code: string, includeDone = false) =>
      request<Agenda>("GET", `/api/agenda/division/${encodeURIComponent(code)}`, { query: { includeDone } }),
  },
  today: (signal?: AbortSignal) => request<TodayView>("GET", "/api/today", { signal }),
  search: (q: string, signal?: AbortSignal) => request<SearchResult>("GET", "/api/search", { query: { q }, signal }),

  people: {
    list: () => request<Person[]>("GET", "/api/people"),
    create: (input: PersonInput) => request<Person>("POST", "/api/people", { body: input }),
    update: (id: number, patch: PersonPatch) => request<Person>("PATCH", `/api/people/${id}`, { body: patch }),
  },
  divisions: {
    list: () => request<Division[]>("GET", "/api/divisions"),
    create: (input: DivisionInput) => request<Division>("POST", "/api/divisions", { body: input }),
    update: (code: string, patch: DivisionPatch) =>
      request<Division>("PATCH", `/api/divisions/${encodeURIComponent(code)}`, { body: patch }),
  },
  initiatives: {
    list: () => request<Initiative[]>("GET", "/api/initiatives"),
    create: (input: InitiativeInput) => request<Initiative>("POST", "/api/initiatives", { body: input }),
    update: (id: number, patch: InitiativePatch) => request<Initiative>("PATCH", `/api/initiatives/${id}`, { body: patch }),
  },

  captures: {
    list: (status?: CaptureStatus, signal?: AbortSignal) =>
      request<CaptureSummary[]>("GET", "/api/captures", { query: { status }, signal }),
    get: (id: string, signal?: AbortSignal) => request<Capture>("GET", `/api/captures/${encodeURIComponent(id)}`, { signal }),
    create: (input: CaptureCreateInput) => {
      const form = new FormData();
      if (input.text) form.set("text", input.text);
      if (input.context) form.set("context", input.context);
      if (input.defaultDivisionCode) form.set("defaultDivisionCode", input.defaultDivisionCode);
      if (input.title) form.set("title", input.title);
      for (const file of input.files ?? []) form.append("files", file, file.name);
      return request<Capture>("POST", "/api/captures", { form });
    },
    reextract: (id: string) => request<Capture>("POST", `/api/captures/${encodeURIComponent(id)}/reextract`),
    accept: (id: string, pid: string, overrides: Partial<ItemDraft>) =>
      request<AcceptResult>("POST", `/api/captures/${encodeURIComponent(id)}/proposals/${encodeURIComponent(pid)}/accept`, {
        body: overrides,
      }),
    reject: (id: string, pid: string) =>
      request<Proposal>("POST", `/api/captures/${encodeURIComponent(id)}/proposals/${encodeURIComponent(pid)}/reject`),
    updateProposal: (id: string, pid: string, draft: ItemDraft) =>
      request<Proposal>("PATCH", `/api/captures/${encodeURIComponent(id)}/proposals/${encodeURIComponent(pid)}`, {
        body: { draft },
      }),
    acceptAll: (id: string) => request<{ items: Item[] }>("POST", `/api/captures/${encodeURIComponent(id)}/accept-all`),
    discard: (id: string) => request<void>("POST", `/api/captures/${encodeURIComponent(id)}/discard`),
    fileUrl: (id: string, fileId: string) =>
      `/api/captures/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
  },

  importer: {
    preview: (file: File) => {
      const form = new FormData();
      form.set("file", file, file.name);
      return request<ImportPreview>("POST", "/api/import/preview", { form });
    },
    /** `filename` names the provenance capture ("Import: brain.xlsm"). */
    commit: (rows: ImportRow[], filename?: string) =>
      request<ImportCommitResult>("POST", "/api/import/commit", { body: filename ? { filename, rows } : { rows } }),
  },

  briefs: {
    list: (limit = 20) => request<Brief[]>("GET", "/api/briefs", { query: { limit } }),
    create: (input: BriefInput) => request<Brief>("POST", "/api/briefs", { body: input }),
    remove: (id: string) => request<void>("DELETE", `/api/briefs/${encodeURIComponent(id)}`),
  },
};
