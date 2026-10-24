import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { transaction } from "@/lib/db";
import { DEFAULT_SLA, resolveSla } from "@/lib/ops-config";
import { getSlaSettings, SlaSettingsError, updateSlaOverrides } from "@/lib/sla-settings";
import { getAttentionItems } from "@/lib/operations";
import { createDraftOrder } from "@/lib/orders";
import { isEmailConfigured, sendEmail, EmailSendError } from "@/lib/email";
import { notify, listNotifications } from "@/lib/notifications";
import { phoneKeyOf } from "@/lib/phone";

describe("resolveSla", () => {
  it("falls back to the defaults entirely when there are no overrides", () => {
    expect(resolveSla(null)).toEqual(DEFAULT_SLA);
    expect(resolveSla(undefined)).toEqual(DEFAULT_SLA);
    expect(resolveSla({})).toEqual(DEFAULT_SLA);
  });

  it("merges a partial override onto the defaults, leaving the rest untouched", () => {
    const resolved = resolveSla({ paymentOverdueWarnHours: 12 });
    expect(resolved.paymentOverdueWarnHours).toBe(12);
    expect(resolved.shipOverdueWarnHours).toBe(DEFAULT_SLA.shipOverdueWarnHours);
  });

  it("ignores an invalid value (not a number, zero, negative) and keeps the default", () => {
    const resolved = resolveSla({ paymentOverdueWarnHours: -5, shipOverdueWarnHours: "soon", draftStaleWarnHours: 0 });
    expect(resolved.paymentOverdueWarnHours).toBe(DEFAULT_SLA.paymentOverdueWarnHours);
    expect(resolved.shipOverdueWarnHours).toBe(DEFAULT_SLA.shipOverdueWarnHours);
    expect(resolved.draftStaleWarnHours).toBe(DEFAULT_SLA.draftStaleWarnHours);
  });
});

describe("per-organization SLA overrides", () => {
  let organizationId: string;
  let ownerId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "SLA Settings Org" } });
    organizationId = org.id;
    const owner = await prisma.user.create({
      data: { email: "sla-owner@example.com", passwordHash: "x", name: "Owner", memberships: { create: { organizationId, role: "OWNER" } } },
    });
    ownerId = owner.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts with no overrides — the effective thresholds are the defaults", async () => {
    const settings = await getSlaSettings(organizationId);
    expect(settings.overrides).toEqual({});
    expect(settings.effective).toEqual(DEFAULT_SLA);
  });

  it("refuses a non-owner", async () => {
    await expect(
      updateSlaOverrides({ organizationId, actor: { role: "STAFF" }, overrides: { draftStaleWarnHours: 12 } })
    ).rejects.toBeInstanceOf(SlaSettingsError);
  });

  it("refuses a non-positive, non-integer or absurdly large value", async () => {
    for (const bad of [0, -3, 1.5, 24 * 365 + 1]) {
      await expect(
        updateSlaOverrides({ organizationId, actor: { role: "OWNER" }, overrides: { draftStaleWarnHours: bad } })
      ).rejects.toBeInstanceOf(SlaSettingsError);
    }
  });

  it("refuses a warning threshold that isn't sooner than its own critical threshold", async () => {
    await expect(
      updateSlaOverrides({
        organizationId,
        actor: { role: "OWNER" },
        overrides: { paymentOverdueWarnHours: 200, paymentOverdueCriticalHours: 100 },
      })
    ).rejects.toThrow(/warning threshold/);
  });

  it("saves, takes effect immediately, and a blank field reverts to the default", async () => {
    await updateSlaOverrides({
      organizationId,
      actor: { role: "OWNER" },
      overrides: { draftStaleWarnHours: 6 },
    });
    const after = await getSlaSettings(organizationId);
    expect(after.overrides).toEqual({ draftStaleWarnHours: 6 });
    expect(after.effective.draftStaleWarnHours).toBe(6);
    expect(after.effective.paymentOverdueWarnHours).toBe(DEFAULT_SLA.paymentOverdueWarnHours); // untouched

    // A real attention-queue read sees the override, not the hardcoded default.
    const phone = "+1555998800";
    const customer = await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: "SLA Customer" } });
    const product = await prisma.product.create({ data: { organizationId, sku: "SLA-1", name: "SLA Product", priceCents: 1000 } });
    const draft = await createDraftOrder({ organizationId, customerId: customer.id, createdById: ownerId, items: [{ productId: product.id, quantity: 1 }] });
    await prisma.order.update({ where: { id: draft.id }, data: { createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000) } }); // 7h old — below the 24h default, above the 6h override

    const { items } = await getAttentionItems(organizationId);
    expect(items.find((i) => i.id === draft.id)).toBeDefined();

    // Not an override that exists in a vacuum — a different org never sees it.
    const otherOrg = await prisma.organization.create({ data: { name: "SLA Other Org" } });
    const otherSettings = await getSlaSettings(otherOrg.id);
    expect(otherSettings.overrides).toEqual({});

    // Blanking it out (submitting with that key absent) reverts to the default wholesale.
    await updateSlaOverrides({ organizationId, actor: { role: "OWNER" }, overrides: {} });
    const reverted = await getSlaSettings(organizationId);
    expect(reverted.effective).toEqual(DEFAULT_SLA);
  });

});

describe("email notification channel", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("is not configured without both RESEND_API_KEY and EMAIL_FROM", () => {
    expect(isEmailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "key";
    expect(isEmailConfigured()).toBe(false);
    process.env.EMAIL_FROM = "orders@example.com";
    expect(isEmailConfigured()).toBe(true);
  });

  it("sendEmail refuses to pretend to send when not configured", async () => {
    await expect(sendEmail("a@example.com", "Subject", "Body")).rejects.toBeInstanceOf(EmailSendError);
  });

  it("sendEmail resolves with the provider's id on success", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.EMAIL_FROM = "orders@example.com";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));

    const result = await sendEmail("a@example.com", "Subject", "Body");
    expect(result).toEqual({ id: "email_123" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sendEmail throws, never resolves, on a non-2xx response", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.EMAIL_FROM = "orders@example.com";
    global.fetch = vi.fn().mockResolvedValue(new Response("provider down", { status: 500 }));

    await expect(sendEmail("a@example.com", "Subject", "Body")).rejects.toBeInstanceOf(EmailSendError);
  });
});

describe("notify() layers email on top of the in-app notification", () => {
  let organizationId: string;
  let ownerId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Notify Email Org" } });
    organizationId = org.id;
    ownerId = (
      await prisma.user.create({ data: { email: "notify-email-owner@example.com", passwordHash: "x", name: "Owner" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("never calls out when email isn't configured — the in-app notification still works", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    await transaction(organizationId, (tx) => notify(tx, { organizationId, userIds: [ownerId], kind: "TEST", title: "No email config", dedupeKey: "notify-email-1" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    const notes = await listNotifications(organizationId, ownerId);
    expect(notes.some((n) => n.dedupeKey === "notify-email-1")).toBe(true);
  });

  it("emails every recipient on a genuinely new notification when configured", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.EMAIL_FROM = "orders@example.com";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_abc" }), { status: 200 }));
    global.fetch = fetchSpy;

    await transaction(organizationId, (tx) => notify(tx, { organizationId, userIds: [ownerId], kind: "TEST", title: "Configured", dedupeKey: "notify-email-2" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never re-emails on a retry (all duplicates) — the same dedupe protects both channels", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.EMAIL_FROM = "orders@example.com";
    await transaction(organizationId, (tx) => notify(tx, { organizationId, userIds: [ownerId], kind: "TEST", title: "First", dedupeKey: "notify-email-3" }));

    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_def" }), { status: 200 }));
    global.fetch = fetchSpy;
    const created = await transaction(organizationId, (tx) => notify(tx, { organizationId, userIds: [ownerId], kind: "TEST", title: "Retried", dedupeKey: "notify-email-3" }));
    expect(created).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a failed send doesn't throw past notify() — the in-app notification still lands", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.EMAIL_FROM = "orders@example.com";
    global.fetch = vi.fn().mockResolvedValue(new Response("down", { status: 500 }));

    const created = await transaction(organizationId, (tx) => notify(tx, { organizationId, userIds: [ownerId], kind: "TEST", title: "Provider down", dedupeKey: "notify-email-4" }));
    expect(created).toBe(1);
    const notes = await listNotifications(organizationId, ownerId);
    expect(notes.some((n) => n.dedupeKey === "notify-email-4")).toBe(true);
  });
});
