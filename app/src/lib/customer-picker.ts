import { tenantDb } from "@/lib/db";
import { customerMatch } from "@/lib/search";

/**
 * Customers for the "New order" picker. A business can have thousands of customers, so the page
 * never loads them all: it starts with the most recently active few, and searching asks the server.
 * Each customer comes with the prices agreed with them, which the form needs to preview totals.
 */
export type PickerCustomer = { id: string; name: string | null; phone: string; agreed: Record<string, number> };

const LIMIT = 30;

async function withAgreedPrices(organizationId: string, customers: { id: string; name: string | null; phone: string }[]): Promise<PickerCustomer[]> {
  if (customers.length === 0) return [];
  const rows = await tenantDb(organizationId).customerPrice.findMany({
    where: { organizationId, customerId: { in: customers.map((c) => c.id) } },
    select: { customerId: true, productId: true, priceCents: true },
  });
  const byCustomer = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = byCustomer.get(r.customerId) ?? {};
    m[r.productId] = r.priceCents;
    byCustomer.set(r.customerId, m);
  }
  return customers.map((c) => ({ ...c, agreed: byCustomer.get(c.id) ?? {} }));
}

export async function recentCustomersForPicker(organizationId: string, includeId?: string): Promise<PickerCustomer[]> {
  const db = tenantDb(organizationId);
  const recent = await db.customer.findMany({
    where: { organizationId, mergedIntoId: null },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
    select: { id: true, name: true, phone: true },
  });
  if (includeId && !recent.some((c) => c.id === includeId)) {
    const extra = await db.customer.findFirst({ where: { id: includeId, organizationId, mergedIntoId: null }, select: { id: true, name: true, phone: true } });
    if (extra) recent.unshift(extra);
  }
  return withAgreedPrices(organizationId, recent);
}

export async function searchCustomersForPicker(organizationId: string, q: string): Promise<PickerCustomer[]> {
  const text = q.trim().slice(0, 100);
  if (!text) return recentCustomersForPicker(organizationId);
  const found = await tenantDb(organizationId).customer.findMany({
    where: { organizationId, mergedIntoId: null, ...customerMatch(text) },
    orderBy: { name: "asc" },
    take: LIMIT,
    select: { id: true, name: true, phone: true },
  });
  return withAgreedPrices(organizationId, found);
}
