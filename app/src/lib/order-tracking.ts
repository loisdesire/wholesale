import { randomBytes } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";

/**
 * Customer-facing order status page support.
 *
 * The page lives at /track/<organizationId>/<token>. The token is 144 random bits stored on the
 * order (never derived from the order reference, which is guessable: ORD-1001, ORD-1002…). The
 * organization id in the URL only tells the database which tenant's rows to look in — row-level
 * security still applies, so a token from one business can never open another business's order.
 * The page shows only what a customer needs: no phone, address, prices or notes.
 */

export function newPublicToken(): string {
  return randomBytes(18).toString("base64url");
}

/** The order's tracking token, creating it the first time one is needed. */
export async function ensurePublicToken(organizationId: string, orderId: string): Promise<string> {
  const db = tenantDb(organizationId);
  const existing = await db.order.findUnique({ where: { id: orderId }, select: { publicToken: true } });
  if (!existing) throw new Error("Order not found.");
  if (existing.publicToken) return existing.publicToken;
  // updateMany with a null guard: if two requests race, only one token is kept and both read the winner.
  await db.order.updateMany({ where: { id: orderId, publicToken: null }, data: { publicToken: newPublicToken() } });
  const after = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { publicToken: true } });
  return after.publicToken!;
}

/** Absolute link when APP_URL is configured, otherwise a path (still usable on the same site). */
export function trackingUrl(organizationId: string, token: string): string {
  const path = `/track/${organizationId}/${token}`;
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

export type TrackingView = {
  businessName: string;
  reference: string;
  status: OrderStatus;
  isPaid: boolean;
  createdAt: Date;
  items: { name: string; variantLabel: string | null; quantity: number; shipped: number }[];
  shipments: { reference: string; carrier: string | null; trackingReference: string | null; shippedAt: Date; units: number }[];
};

/** Null for any bad id or token — the page shows one generic "not found" either way. */
export async function getTrackingView(organizationId: string, token: string): Promise<TrackingView | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !/^[A-Za-z0-9]{10,40}$/.test(organizationId)) return null;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  if (!org) return null;

  const db = tenantDb(organizationId);
  const order = await db.order.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      reference: true,
      status: true,
      paidAt: true,
      createdAt: true,
      items: { select: { id: true, variantLabel: true, quantity: true, product: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      shipments: {
        select: { reference: true, carrier: true, trackingReference: true, createdAt: true, items: { select: { orderItemId: true, quantity: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order || order.status === OrderStatus.DRAFT) return null;

  const shippedByItem = new Map<string, number>();
  for (const s of order.shipments) for (const si of s.items) shippedByItem.set(si.orderItemId, (shippedByItem.get(si.orderItemId) ?? 0) + si.quantity);

  return {
    businessName: org.name,
    reference: order.reference,
    status: order.status,
    isPaid: order.paidAt !== null,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({ name: i.product.name, variantLabel: i.variantLabel, quantity: i.quantity, shipped: shippedByItem.get(i.id) ?? 0 })),
    shipments: order.shipments.map((s) => ({
      reference: s.reference,
      carrier: s.carrier,
      trackingReference: s.trackingReference,
      shippedAt: s.createdAt,
      units: s.items.reduce((n, x) => n + x.quantity, 0),
    })),
  };
}
