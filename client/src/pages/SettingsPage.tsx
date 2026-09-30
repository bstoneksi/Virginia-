import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { usePageTitle } from "@/lib/shell";
import { AboutSettings } from "./settings/AboutSettings";
import { ConnectorSettings } from "./settings/ConnectorSettings";
import { DivisionsSettings } from "./settings/DivisionsSettings";
import { ImportSettings } from "./settings/ImportSettings";
import { InitiativesSettings } from "./settings/InitiativesSettings";
import { PeopleSettings } from "./settings/PeopleSettings";

const TABS = [
  { id: "people", label: "People" },
  { id: "divisions", label: "Divisions" },
  { id: "initiatives", label: "Initiatives" },
  { id: "import", label: "Import" },
  { id: "connector", label: "Connector" },
  { id: "about", label: "AI & account" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsPage() {
  usePageTitle("Settings");
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "people";
  const activeRef = useRef<HTMLButtonElement>(null);

  // The strip scrolls sideways on a phone: a deep link to one of the last tabs (?tab=about, the one
  // Logout lives on) must show its highlighted tab, not an unmarked strip.
  useEffect(() => {
    const el = activeRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);

  return (
    <div className="flex flex-col gap-4">
      <nav className="relative -mx-4 md:mx-0" aria-label="Settings sections">
        <div className="overflow-x-auto px-4 md:px-0 [scrollbar-width:none]">
          <div className="inline-flex min-w-full gap-1 border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={tab === t.id ? activeRef : undefined}
                type="button"
                onClick={() => setParams({ tab: t.id }, { replace: true })}
                className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${tab === t.id ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {/* Overflow affordance on narrow screens: the strip fades out at the right edge. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent md:hidden" />
      </nav>
      {tab === "people" && <PeopleSettings />}
      {tab === "divisions" && <DivisionsSettings />}
      {tab === "initiatives" && <InitiativesSettings />}
      {tab === "import" && <ImportSettings />}
      {tab === "connector" && <ConnectorSettings />}
      {tab === "about" && <AboutSettings />}
    </div>
  );
}
