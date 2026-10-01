import { Link } from "react-router";
import { NAV } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { useAssistant, useBootstrap } from "@/lib/bootstrap";
import { usePageTitle } from "@/lib/shell";

/** Phone-only overflow menu for the pages that don't fit in the bottom bar. */
export function MorePage() {
  usePageTitle("More");
  const { version, me } = useBootstrap();
  const { name } = useAssistant();
  return (
    <div className="flex flex-col gap-4">
      <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {NAV.filter((n) => !n.primary).map((n) => (
          <li key={n.to} className="border-b border-slate-100 last:border-b-0">
            <Link to={n.to} className="flex min-h-14 items-center gap-3 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <Icon name={n.icon} className="h-5 w-5 text-slate-500" />
              <span className="flex-1">{n.label}</span>
              <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-center text-xs text-slate-400">
        {name} v{version}
        {me ? ` · signed in as ${me.fullName}` : ""}
      </p>
    </div>
  );
}
