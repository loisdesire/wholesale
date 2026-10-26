"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction, switchOrganizationAction } from "@/app/(app)/actions";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/orders", label: "Orders" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/customers", label: "Customers" },
  { href: "/operations", label: "Operations" },
  { href: "/reports", label: "Reports" },
  { href: "/search", label: "Search" },
  { href: "/billing", label: "Billing", ownerOnly: true },
  { href: "/admin", label: "Platform Admin", platformAdminOnly: true },
];

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
  // slide-in drawer instead, triggered by a small top bar. Closes automatically on navigation
  // so staff aren't left staring at the menu after tapping a link. Adjusted during render, not
  // in an effect (React's own recommended pattern for "reset state when a prop changes") — an
  // unconditional setState in an effect causes an avoidable extra render on every navigation.
  const [open, setOpen] = useState(false);
  const [openForPathname, setOpenForPathname] = useState(pathname);
  if (pathname !== openForPathname) {
    setOpenForPathname(pathname);
    setOpen(false);
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 text-paper md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 hover:bg-white/10"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="truncate font-display text-sm font-semibold tracking-tight">{orgName}</span>
        <span className="w-8" aria-hidden="true" />
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-ink/50 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-none -translate-x-full flex-col bg-ink text-paper transition-transform duration-200 md:relative md:z-auto md:w-56 md:translate-x-0 ${
          open ? "translate-x-0" : ""
        }`}
      >
      <div className="px-5 py-5">
        <span className="font-display text-base font-semibold tracking-tight">{orgName}</span>
        {organizations.length > 1 && (
          <form action={(formData) => switchOrganizationAction(String(formData.get("organizationId")))} className="mt-2">
            <label htmlFor="organization-switch" className="sr-only">
              Switch organization
            </label>
            <select
              id="organization-switch"
              name="organizationId"
              defaultValue={activeOrganizationId}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-full rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-white/50"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id} className="text-ink">
                  {o.name} · {o.role === "OWNER" ? "Owner" : "Staff"}
                </option>
              ))}
            </select>
          </form>
        )}
      </div>

      <nav className="flex-1 px-3">
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link
              href="/notifications"
              className={`flex items-center justify-between rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
                pathname.startsWith("/notifications")
                  ? "border-accent bg-white/10 font-medium text-white"
                  : "border-transparent text-white/65 hover:bg-white/5 hover:text-white"
              }`}
            >
              Notifications
              {unreadNotifications > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium text-accent-ink">
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              )}
            </Link>
          </li>
          {NAV_ITEMS.filter((item) => (!item.ownerOnly || userRole === "OWNER") && (!item.platformAdminOnly || isPlatformAdmin)).map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
                    active
                      ? "border-accent bg-white/10 font-medium text-white"
                      : "border-transparent text-white/65 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{userName}</p>
        <p className="text-xs text-white/50">
          {userRole === "OWNER" ? "Owner" : "Staff"}
        </p>
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-3 text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
      </aside>
    </>
  );
}
