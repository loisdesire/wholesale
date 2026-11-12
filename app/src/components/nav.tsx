"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Bell,
  ChartColumn,
  ChevronsUpDown,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Search,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOutAction, switchOrganizationAction } from "@/app/(app)/actions";
import { Avatar } from "@/components/avatar";

type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean; platformAdminOnly?: boolean };

// Grouped by how the work is done: the daily loop first, then the "how are we doing" views,
// then workspace-level admin. Groups are separated visually, not labelled twice.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Daily",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/orders", label: "Orders", icon: ReceiptText },
      { href: "/catalogue", label: "Catalogue", icon: Package },
      { href: "/customers", label: "Customers", icon: Users },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/operations", label: "Operations", icon: Activity },
      { href: "/reports", label: "Reports", icon: ChartColumn },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/billing", label: "Billing", icon: CreditCard, ownerOnly: true },
      { href: "/admin", label: "Platform Admin", icon: ShieldCheck, platformAdminOnly: true },
    ],
  },
];

// The four destinations staff reach for on a phone; everything else is behind "More".
const TAB_ITEMS: NavItem[] = NAV_GROUPS[0].items.slice(0, 4);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Nav({
  orgName,
  userName,
  userRole,
  organizations,
  activeOrganizationId,
  unreadNotifications,
  isPlatformAdmin,
}: {
  orgName: string;
  userName: string;
  userRole: string;
  organizations: { id: string; name: string; role: string }[];
  activeOrganizationId: string;
  unreadNotifications: number;
  isPlatformAdmin: boolean;
}) {
  const pathname = usePathname();
  // A fixed sidebar permanently visible doesn't fit a phone width — below md it becomes a
  // slide-in drawer instead, opened from the bottom tab bar's "More". Closes automatically on
  // navigation so staff aren't left staring at the menu after tapping a link. Adjusted during
  // render, not in an effect (React's own recommended pattern for "reset state when a prop
  // changes") — an unconditional setState in an effect causes an avoidable extra render on
  // every navigation.
  const [open, setOpen] = useState(false);
  const [openForPathname, setOpenForPathname] = useState(pathname);
  if (pathname !== openForPathname) {
    setOpenForPathname(pathname);
    setOpen(false);
  }

  const unreadLabel = unreadNotifications > 99 ? "99+" : String(unreadNotifications);
  const visible = (item: NavItem) =>
    (!item.ownerOnly || userRole === "OWNER") && (!item.platformAdminOnly || isPlatformAdmin);
  const itemClass = (active: boolean) =>
    `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      active ? "bg-ink font-medium text-white shadow-sm" : "text-text-muted hover:bg-paper hover:text-ink"
    }`;

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={orgName} shape="square" size="sm" />
          <span className="truncate text-sm font-semibold text-ink">{orgName}</span>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/search" aria-label="Search" className="rounded-lg p-2 text-text-muted hover:bg-paper hover:text-ink">
            <Search size={19} />
          </Link>
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="relative rounded-lg p-2 text-text-muted hover:bg-paper hover:text-ink"
          >
            <Bell size={19} />
            {unreadNotifications > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                {unreadLabel}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {TAB_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? "text-accent" : "text-text-muted"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
              {item.label === "Dashboard" ? "Home" : item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-text-muted"
        >
          <Menu size={20} strokeWidth={1.8} />
          More
        </button>
      </nav>

      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-ink/40 backdrop-blur-[2px] md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-72 flex-none -translate-x-full flex-col border-r border-line bg-surface transition-transform duration-200 md:sticky md:top-0 md:z-auto md:w-60 md:translate-x-0 ${
          open ? "translate-x-0 shadow-pop" : ""
        }`}
      >
        <div className="flex items-center gap-2 px-3 pt-4">
          <div className="relative flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-paper">
            <Avatar name={orgName} shape="square" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight text-ink">{orgName}</p>
              <p className="text-xs leading-tight text-text-muted">{userRole === "OWNER" ? "Owner" : "Staff"} workspace</p>
            </div>
            {organizations.length > 1 && (
              <form action={(formData) => switchOrganizationAction(String(formData.get("organizationId")))}>
                <ChevronsUpDown size={15} className="text-text-muted" aria-hidden="true" />
                <label htmlFor="organization-switch" className="sr-only">
                  Switch organization
                </label>
                {/* The native select covers the whole org card (invisible), so the entire card is
                    the switcher and the OS picker is used on phones. */}
                <select
                  id="organization-switch"
                  name="organizationId"
                  defaultValue={activeOrganizationId}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {o.role === "OWNER" ? "Owner" : "Staff"}
                    </option>
                  ))}
                </select>
              </form>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-2 text-text-muted hover:bg-paper md:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3 pt-3">
          <Link
            href="/search"
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
              pathname.startsWith("/search")
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-paper/60 text-text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            <Search size={16} />
            Search everything
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-4" aria-label="Sections">
          <ul className="flex flex-col gap-0.5">
            <li>
              <Link href="/notifications" className={itemClass(pathname.startsWith("/notifications"))}>
                <Bell size={17} strokeWidth={1.9} />
                <span className="flex-1">Notifications</span>
                {unreadNotifications > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">
                    {unreadLabel}
                  </span>
                )}
              </Link>
            </li>
          </ul>
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mt-5">
                <p className="eyebrow px-3 pb-1.5">{group.label}</p>
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link href={item.href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
                          <Icon size={17} strokeWidth={1.9} />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
          <Avatar name={userName || "?"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-ink">{userName}</p>
            <p className="text-xs leading-tight text-text-muted">{userRole === "OWNER" ? "Owner" : "Staff"}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-paper hover:text-ink"
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
