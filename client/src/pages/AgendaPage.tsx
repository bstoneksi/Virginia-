import { Link, useParams } from "react-router";
import { AgendaView } from "@/components/AgendaView";
import { Avatar, DivisionChip } from "@/components/Badges";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { usePageTitle } from "@/lib/shell";

export function AgendaPage() {
  const { initials = "" } = useParams();
  const { person, division } = useBootstrap();
  const p = person(initials);
  usePageTitle(p ? p.fullName : initials);

  if (!p) {
    return (
      <EmptyState
        title={`No one with initials "${initials}"`}
        hint="Check Settings → People, or pick someone from the list."
        action={
          <Link to="/people" className="text-sm font-medium text-brand underline">
            Back to People
          </Link>
        }
      />
    );
  }
  const div = division(p.divisionCode);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <Link to="/people" className="no-print -ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back to people">
          <Icon name="chevronLeft" />
        </Link>
        <Avatar initials={p.initials} size="lg" title={p.fullName} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight text-slate-900">{p.fullName}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">{p.initials}</span>
            {p.role && <span>· {p.role}</span>}
            {div && <DivisionChip division={div} />}
            {p.email && (
              <a href={`mailto:${p.email}`} className="no-print truncate text-brand underline">
                {p.email}
              </a>
            )}
          </p>
        </div>
      </header>
      <AgendaView subject={{ type: "person", key: p.initials }} quickAddDefaults={{ ownerInitials: p.initials }} />
    </div>
  );
}
