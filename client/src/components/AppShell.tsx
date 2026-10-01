import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useAssistant, useBootstrap } from "@/lib/bootstrap";
import { usePendingCaptures, useTitleContext } from "@/lib/shell";
import { Icon, type IconName } from "./Icon";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown in the phone bottom bar. */
  primary?: boolean;
  badge?: boolean;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Today", icon: "today", primary: true },
  { to: "/board", label: "Board", icon: "board", primary: true },
  { to: "/people", label: "People", icon: "people", primary: true },
  { to: "/capture", label: "Capture", icon: "inbox", primary: true, badge: true },
  { to: "/brands", label: "Brands", icon: "brands" },
  { to: "/personal", label: "Personal", icon: "personal" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/briefs", label: "Briefs", icon: "briefs" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

const TITLE_BY_PREFIX: [string, string][] = [
  ["/board", "Board"],
  ["/people", "People"],
  ["/brands", "Brands"],
  ["/personal", "Personal"],
  ["/capture", "Inbox"],
  ["/search", "Search"],
  ["/briefs", "Briefs"],
  ["/settings", "Settings"],
  ["/more", "More"],
];

function defaultTitle(pathname: string, fallback: string): string {
  if (pathname === "/") return "Today";
  const hit = TITLE_BY_PREFIX.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : fallback;
}

function isPrimaryPath(pathname: string): boolean {
  return NAV.filter((n) => n.primary).some((n) => (n.to === "/" ? pathname === "/" : pathname === n.to || pathname.startsWith(`${n.to}/`)));
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppShell() {
  const { title } = useTitleContext();
  const { count } = usePendingCaptures();
  const { version } = useBootstrap();
  const { name } = useAssistant();
  const location = useLocation();
  const shownTitle = title ?? defaultTitle(location.pathname, name);

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="no-print hidden md:fixed md:inset-y-0 md:left-0 md:flex md:w-56 md:flex-col md:border-r md:border-slate-200 md:bg-white">
        <Link to="/" className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <svg viewBox="0 0 128 128" className="h-5 w-5" aria-hidden="true">
              <path d="M30 34 L64 100 L98 34" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-base font-semibold text-slate-900">{name}</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium ${isActive ? "bg-brand/10 text-brand" : "text-slate-700 hover:bg-slate-100"}`
              }
            >
              <span className="relative">
                <Icon name={n.icon} className="h-5 w-5" />
                {n.badge && <Badge count={count} />}
              </span>
              {n.label}
              {n.badge && count > 0 && <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{count}</span>}
            </NavLink>
          ))}
        </nav>
        <p className="px-4 py-3 text-[11px] text-slate-400">v{version}</p>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col md:pl-56">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-safe backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-4">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900">{shownTitle}</h1>
            <Link to="/search" className="flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Search">
              <Icon name="search" />
            </Link>
            <Link to="/capture" className="relative flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100" aria-label={`Inbox, ${count} pending`}>
              <Icon name="inbox" />
              <Badge count={count} />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 overflow-x-hidden px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Phone bottom nav */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-safe md:hidden" aria-label="Primary">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => n.primary).map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) => `flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? "text-brand" : "text-slate-500"}`}
              >
                <span className="relative">
                  <Icon name={n.icon} className="h-6 w-6" />
                  {n.badge && <Badge count={count} />}
                </span>
                {n.label}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink
              to="/more"
              className={({ isActive }) =>
                `flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive || !isPrimaryPath(location.pathname) ? "text-brand" : "text-slate-500"}`
              }
            >
              <Icon name="more" className="h-6 w-6" />
              More
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}
