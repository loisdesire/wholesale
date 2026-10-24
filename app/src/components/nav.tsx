"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
];

export function Nav({
  orgName,
  userName,
  userRole,
  organizations,
  activeOrganizationId,
  unreadNotifications,
}: {
  orgName: string;
  userName: string;
  userRole: string;
  organizations: { id: string; name: string; role: string }[];
  activeOrganizationId: string;
  unreadNotifications: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-none flex-col bg-ink text-paper">
      <div className="px-5 py-5">
        <span className="text-sm font-medium tracking-tight">{orgName}</span>
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
              className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                pathname.startsWith("/notifications")
                  ? "bg-white/10 font-medium text-white"
                  : "text-white/65 hover:bg-white/5 hover:text-white"
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
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-white/10 font-medium text-white"
                      : "text-white/65 hover:bg-white/5 hover:text-white"
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
  );
}
