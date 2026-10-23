"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(app)/actions";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/orders", label: "Orders" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/customers", label: "Customers" },
  { href: "/search", label: "Search" },
];

export function Nav({
  orgName,
  userName,
  userRole,
}: {
  orgName: string;
  userName: string;
  userRole: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-none flex-col bg-ink text-paper">
      <div className="px-5 py-5">
        <span className="text-sm font-medium tracking-tight">{orgName}</span>
      </div>

      <nav className="flex-1 px-3">
        <ul className="flex flex-col gap-0.5">
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
