"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction, switchOrganizationAction } from "@/app/(app)/actions";
import {
  LayoutDashboard,
  Inbox,
  ShoppingBag,
  Layers,
  Users,
  Search,
  CreditCard,
  ShieldCheck,
  Bell,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Building2,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
  platformAdminOnly?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

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
  const [open, setOpen] = useState(false);
  const [openForPathname, setOpenForPathname] = useState(pathname);
  if (pathname !== openForPathname) {
    setOpenForPathname(pathname);
    setOpen(false);
  }

  const navGroups: NavGroup[] = [
    {
      title: "Daily Operations",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/inbox", label: "Inbox", icon: Inbox },
        { href: "/orders", label: "Orders", icon: ShoppingBag },
      ],
    },
    {
      title: "Commerce & Trade",
      items: [
        { href: "/catalogue", label: "Catalogue & Stock", icon: Layers },
        { href: "/customers", label: "Customers", icon: Users },
        { href: "/search", label: "Quick Search", icon: Search },
      ],
    },
  ];

  const systemItems: NavItem[] = [];
  if (userRole === "OWNER") {
    systemItems.push({ href: "/billing", label: "Billing & Subscription", icon: CreditCard, ownerOnly: true });
  }
  if (isPlatformAdmin) {
    systemItems.push({ href: "/admin", label: "Platform Operator", icon: ShieldCheck, platformAdminOnly: true });
  }
  if (systemItems.length > 0) {
    navGroups.push({ title: "Account & System", items: systemItems });
  }

  return (
    <>
      {/* Mobile Sticky Bar (Clean touch targets: min 44x44px) */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-ink px-3 text-paper md:hidden shadow-md">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-xs font-bold text-white shadow-xs">
              {orgName.charAt(0)}
            </div>
            <span className="truncate font-display text-sm font-semibold tracking-tight text-white max-w-[180px]">
              {orgName}
            </span>
          </div>
        </div>

        <Link
          href="/notifications"
          className="relative flex h-11 w-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadNotifications > 0 && (
            <span className="absolute top-2.5 right-2.5 flex h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-ink" />
          )}
        </Link>
      </div>

      {/* Drawer Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-xs transition-opacity md:hidden"
        />
      )}

      {/* Main Sidebar (Sticky pinned on desktop, smooth drawer on mobile) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-72 max-w-[85vw] flex-none -translate-x-full flex-col bg-ink text-paper shadow-2xl transition-transform duration-250 ease-out md:sticky md:top-0 md:h-screen md:w-64 md:z-20 md:translate-x-0 md:shadow-none border-r border-white/10 ${
          open ? "translate-x-0" : ""
        }`}
      >
        {/* Brand Luxury Seal & Mobile Close Button */}
        <div className="flex flex-col border-b border-white/10 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-white/15 to-white/5 border border-white/20 shadow-inner">
                <span className="font-display text-lg font-bold text-paper tracking-wider">
                  {orgName.charAt(0) || "W"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-semibold text-white tracking-tight">
                  {orgName}
                </span>
                <span className="block text-xs font-medium text-white/70 tracking-wide">
                  Wholesale Hub
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white md:hidden transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Organization Switcher if Multi-Tenant */}
          {organizations.length > 1 && (
            <div className="mt-3.5 pt-3 border-t border-white/10">
              <form action={(formData) => switchOrganizationAction(String(formData.get("organizationId")))}>
                <label htmlFor="organization-switch" className="sr-only">
                  Switch organization
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                  <select
                    id="organization-switch"
                    name="organizationId"
                    defaultValue={activeOrganizationId}
                    onChange={(e) => e.target.form?.requestSubmit()}
                    className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 py-2 pl-9 pr-8 text-xs font-semibold text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  >
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id} className="bg-ink text-paper">
                        {org.name} ({org.role === "OWNER" ? "Owner" : "Staff"})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {/* Notifications Highlight Link */}
          <div>
            <Link
              href="/notifications"
              className={`group flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all ${
                pathname.startsWith("/notifications")
                  ? "bg-accent text-white shadow-md shadow-accent/25"
                  : "text-white/75 hover:bg-white/[0.07] hover:text-white"
              }`}
            >
              <div className="flex items-center gap-3">
                <Bell className="h-4 w-4 shrink-0 transition-transform group-hover:scale-105" />
                <span>Notifications</span>
              </div>
              {unreadNotifications > 0 ? (
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-tabular text-xs font-bold ${
                    pathname.startsWith("/notifications")
                      ? "bg-white text-accent"
                      : "bg-accent text-white shadow-xs"
                  }`}
                >
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              ) : (
                <span className="text-xs text-white/50 font-mono">0</span>
              )}
            </Link>
          </div>

          {/* Grouped Links */}
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <span className="px-3 text-xs font-semibold uppercase tracking-wider text-white/70">
                {group.title}
              </span>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`group flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                          active
                            ? "bg-accent text-white shadow-md shadow-accent/25"
                            : "text-white/75 hover:bg-white/[0.07] hover:text-white"
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-105 ${
                            active ? "text-white" : "text-white/60 group-hover:text-white"
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User Presence & Sign Out Dock */}
        <div className="border-t border-white/10 p-3.5 pb-6 md:pb-3.5">
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] p-3 border border-white/5">
            <div className="flex items-center gap-3 min-w-0 pr-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white font-display text-xs font-bold shadow-xs">
                {userName.charAt(0) || "U"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">{userName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      userRole === "OWNER" ? "bg-gold" : "bg-emerald-400"
                    }`}
                  />
                  <span className="text-xs font-medium text-white/80 tracking-wide uppercase">
                    {userRole === "OWNER" ? "Owner Account" : "Staff Member"}
                  </span>
                </div>
              </div>
            </div>

            <form action={signOutAction}>
              <button
                type="submit"
                title="Sign out of account"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
