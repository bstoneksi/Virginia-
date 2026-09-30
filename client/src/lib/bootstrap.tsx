import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bootstrap, Division, Initiative, Person } from "@shared/types";
import { api, errorMessage } from "@/api";
import { FullScreenMessage } from "@/components/States";
import { Button } from "@/components/Field";

interface BootstrapContextValue {
  data: Bootstrap;
  reload: () => Promise<void>;
}

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

/** Loads GET /api/bootstrap once and gates its children until reference data is available. */
export function BootstrapProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api
      .bootstrap(controller.signal)
      .then((result) => setData(result))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(async () => {
    try {
      setData(await api.bootstrap());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const value = useMemo(() => (data ? { data, reload } : null), [data, reload]);

  if (!value) {
    if (error) {
      return (
        <FullScreenMessage
          title="Virginia can't reach the server"
          detail={error}
          action={
            <Button onClick={() => setAttempt((a) => a + 1)} variant="primary">
              Retry
            </Button>
          }
        />
      );
    }
    return <FullScreenMessage title="Loading Virginia…" spinner />;
  }
  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}

export interface RefData {
  bootstrap: Bootstrap;
  /** Non-archived divisions sorted by sortOrder. */
  divisions: Division[];
  allDivisions: Division[];
  /** Non-archived people sorted by full name. */
  people: Person[];
  allPeople: Person[];
  initiatives: Initiative[];
  me: Person | null;
  aiConfigured: boolean;
  anthropicModel: string;
  mcpConfigured: boolean;
  /** Full connector URL (contains the MCP token); null until MCP_TOKEN is set on the server. */
  mcpUrl: string | null;
  version: string;
  division: (code: string | null | undefined) => Division | undefined;
  person: (initials: string | null | undefined) => Person | undefined;
  initiativeName: (id: number | null | undefined) => string | null;
  reload: () => Promise<void>;
}

export function useBootstrap(): RefData {
  const ctx = useContext(BootstrapContext);
  if (!ctx) throw new Error("useBootstrap must be used inside <BootstrapProvider>");
  const { data, reload } = ctx;
  return useMemo<RefData>(() => {
    const allDivisions = [...data.divisions].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    const allPeople = [...data.people].sort((a, b) => a.fullName.localeCompare(b.fullName));
    const divisionMap = new Map(allDivisions.map((d) => [d.code, d]));
    const personMap = new Map(allPeople.map((p) => [p.initials, p]));
    const initiativeMap = new Map(data.initiatives.map((i) => [i.id, i.name]));
    const initiatives = [...data.initiatives].sort(
      (a, b) => Number(a.status !== "Active") - Number(b.status !== "Active") || a.name.localeCompare(b.name),
    );
    return {
      bootstrap: data,
      divisions: allDivisions.filter((d) => !d.archived),
      allDivisions,
      people: allPeople.filter((p) => !p.archived),
      allPeople,
      initiatives,
      me: data.me,
      aiConfigured: data.aiConfigured,
      anthropicModel: data.anthropicModel,
      mcpConfigured: data.mcpConfigured,
      mcpUrl: data.mcpUrl,
      version: data.version,
      division: (code) => (code ? divisionMap.get(code) : undefined),
      person: (initials) => (initials ? personMap.get(initials) : undefined),
      initiativeName: (id) => (id === null || id === undefined ? null : (initiativeMap.get(id) ?? null)),
      reload,
    };
  }, [data, reload]);
}
