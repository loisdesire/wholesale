import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma, tenantRoot } from "@/lib/prisma";
import { tenantDb, transaction } from "@/lib/db";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { createDraftOrder } from "@/lib/orders";
import { resolveActiveMembership } from "@/lib/membership";
import { resolveOrganizationForWhatsApp } from "@/lib/whatsapp-routing";
import { checkTenantIsolation } from "@/lib/isolation-check";

/**
 * These tests talk to Postgres as the restricted application role (see
 * tests/global-setup.ts) and prove the DATABASE refuses cross-tenant access —
 * independent of any `where organizationId` the application code remembers to write.
 */
describe("tenant isolation (row-level security)", () => {
  let orgA: string;
  let orgB: string;
  let a: { productId: string; customerId: string; orderId: string; conversationId: string };
  let b: { productId: string; customerId: string; orderId: string; conversationId: string };

  async function seedTenant(name: string, tag: string) {
    const org = await prisma.organization.create({ data: { name } });
    const user = await prisma.user.create({
      data: { email: `${tag}@iso.example`, passwordHash: "x", name: tag, memberships: { create: { organizationId: org.id, role: "OWNER" } } },
    });
    const product = await prisma.product.create({
      data: { organizationId: org.id, sku: `ISO-${tag}`, name: `Product ${tag}`, priceCents: 1000, priceTiers: { create: [{ minQuantity: 10, priceCents: 900 }] } },
    });
    await recordStockMovement({ organizationId: org.id, productId: product.id, quantityDelta: 50, reason: StockMovementReason.INITIAL_STOCK });
    const phone = `+1555${tag === "a" ? "1111111" : "2222222"}`;
    const customer = await prisma.customer.create({
      data: { organizationId: org.id, phone, phoneKey: phoneKeyOf(phone)!, name: `Customer ${tag}` },
    });
    const order = await createDraftOrder({
      organizationId: org.id, customerId: customer.id, createdById: user.id, items: [{ productId: product.id, quantity: 2 }],
    });
    const conversation = await prisma.conversation.create({ data: { organizationId: org.id, customerId: customer.id } });
    await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", sender: "CUSTOMER", body: `hello ${tag}` } });
    return { org, ids: { productId: product.id, customerId: customer.id, orderId: order.id, conversationId: conversation.id } };
  }

  beforeAll(async () => {
    const [x, y] = [await seedTenant("Isolation A", "a"), await seedTenant("Isolation B", "b")];
    orgA = x.org.id;
    orgB = y.org.id;
    a = x.ids;
    b = y.ids;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Run raw SQL as the restricted role with (or without) an organization context. */
  async function asTenant<T>(organizationId: string | null, fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
    return tenantRoot.$transaction(async (tx) => {
      if (organizationId) await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      return fn(tx as unknown as typeof prisma);
    });
  }

  it("the application's connection really is a restricted role (otherwise RLS would be silently skipped)", async () => {
    const [role] = await tenantRoot.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    expect(role.current_user).not.toBe((await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`)[0].current_user);
  });

  it("the startup check reports enforcement for this connection", async () => {
    expect(await checkTenantIsolation()).toMatchObject({ enforced: true, problems: [] });
  });

  it("every table that holds tenant data has row-level security enabled, forced and a policy — a new table can't be forgotten", async () => {
    const tables = await prisma.$queryRaw<{ table: string; has_org: boolean; rls: boolean; forced: boolean; policies: bigint }[]>`
      SELECT c.relname AS "table",
             EXISTS (SELECT 1 FROM information_schema.columns k
                      WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'organizationId') AS has_org,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;

    // Identity / tenant registry: read before any tenant is known, carries no tenant data.
    const registry = new Set(["User", "Membership", "Organization"]);
    // Child tables with no organizationId of their own, protected through their parent.
    const children = new Set(["Message", "MessageAttachment", "OrderItem", "PriceTier", "ProductImage", "ReturnItem", "ShipmentItem"]);

    const unprotected = tables
      .filter((t) => !registry.has(t.table))
      .filter((t) => !(t.rls && t.forced && Number(t.policies) > 0))
      .map((t) => t.table);
    expect(unprotected, `tables without enforced RLS: ${unprotected.join(", ")}`).toEqual([]);

    for (const t of tables) {
      if (!registry.has(t.table) && !children.has(t.table)) expect(t.has_org, `${t.table} has no organizationId and isn't a known child table`).toBe(true);
    }
  });

  it("a query with no organization context sees nothing, in any tenant table (fails closed)", async () => {
    const tables = ["Product", "StockMovement", "Customer", "Conversation", "Message", "Order", "OrderItem", "AuditLog", "PriceTier"];
    for (const table of tables) {
      const [row] = await asTenant(null, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`));
      expect(Number(row.n), table).toBe(0);
    }
    // …while the owner (who fixtures use) sees them, so the zero above is the policy, not an empty table.
    const [owner] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Order"`;
    expect(Number(owner.n)).toBeGreaterThanOrEqual(2);
  });

  it("each organization sees exactly its own rows, in every tenant table", async () => {
    for (const [org, other] of [[orgA, orgB], [orgB, orgA]] as const) {
      for (const table of ["Product", "StockMovement", "Customer", "Conversation", "Order"]) {
        const rows = await asTenant(org, (tx) => tx.$queryRawUnsafe<{ organizationId: string }[]>(`SELECT "organizationId" FROM "${table}"`));
        expect(rows.length, table).toBeGreaterThan(0);
        expect(rows.every((r) => r.organizationId === org), `${table} leaked ${other}'s rows`).toBe(true);
      }
    }
  });

  it("child tables are hidden with their parents", async () => {
    const [{ n: msgs }] = await asTenant(orgA, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Message" WHERE "conversationId" = '${b.conversationId}'`));
    const [{ n: items }] = await asTenant(orgA, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "OrderItem" WHERE "orderId" = '${b.orderId}'`));
    const [{ n: tiers }] = await asTenant(orgA, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "PriceTier" WHERE "productId" = '${b.productId}'`));
    expect([Number(msgs), Number(items), Number(tiers)]).toEqual([0, 0, 0]);
    // And its own are visible.
    const [{ n: own }] = await asTenant(orgA, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Message" WHERE "conversationId" = '${a.conversationId}'`));
    expect(Number(own)).toBe(1);
  });

  it("cannot write a row into another organization", async () => {
    await expect(
      asTenant(orgA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "Product" ("id","organizationId","sku","name","priceCents","updatedAt") VALUES ('planted','${orgB}','PLANT','Planted',1,now())`
        )
      )
    ).rejects.toThrow(/row-level security/);
    expect(await prisma.product.count({ where: { id: "planted" } })).toBe(0);
  });

  it("cannot change or delete another organization's rows (they simply aren't there to touch)", async () => {
    const updated = await asTenant(orgA, (tx) => tx.$executeRawUnsafe(`UPDATE "Customer" SET "name" = 'Hijacked' WHERE "id" = '${b.customerId}'`));
    const deleted = await asTenant(orgA, (tx) => tx.$executeRawUnsafe(`DELETE FROM "Order" WHERE "id" = '${b.orderId}'`));
    expect([updated, deleted]).toEqual([0, 0]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: b.customerId } })).name).toBe("Customer b");
    expect(await prisma.order.count({ where: { id: b.orderId } })).toBe(1);
  });

  it("cannot move one of its own rows into another organization", async () => {
    await expect(
      asTenant(orgA, (tx) => tx.$executeRawUnsafe(`UPDATE "Customer" SET "organizationId" = '${orgB}' WHERE "id" = '${a.customerId}'`))
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot attach a child row to another organization's parent", async () => {
    await expect(
      asTenant(orgA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "Message" ("id","conversationId","direction","sender","body") VALUES ('planted-msg','${b.conversationId}','INBOUND','CUSTOMER','planted')`
        )
      )
    ).rejects.toThrow(/row-level security/);
    expect(await prisma.message.count({ where: { id: "planted-msg" } })).toBe(0);
  });

  describe("through the application's tenant client", () => {
    it("tenantDb(A) can't find B's records by id, even though it asks for them directly", async () => {
      expect(await tenantDb(orgA).order.findUnique({ where: { id: b.orderId } })).toBeNull();
      expect(await tenantDb(orgA).customer.findFirst({ where: { id: b.customerId } })).toBeNull();
      expect(await tenantDb(orgA).product.findMany({ where: { id: b.productId } })).toEqual([]);
      expect(await tenantDb(orgB).order.findUnique({ where: { id: b.orderId } })).not.toBeNull();
    });

    it("a `where` that forgets the organization still can't see across tenants", async () => {
      const all = await tenantDb(orgA).customer.findMany(); // no organizationId filter at all
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((c) => c.organizationId === orgA)).toBe(true);
      expect(await tenantDb(orgA).order.count()).toBe(await prisma.order.count({ where: { organizationId: orgA } }));
    });

    it("can't update or delete across tenants", async () => {
      await expect(tenantDb(orgA).order.update({ where: { id: b.orderId }, data: { notes: "pwned" } })).rejects.toThrow();
      await expect(tenantDb(orgA).customer.delete({ where: { id: b.customerId } })).rejects.toThrow();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).notes).toBeNull();
    });

    it("an interactive transaction is confined too", async () => {
      const seen = await transaction(orgA, async (tx) => ({
        orders: await tx.order.findMany(),
        foreign: await tx.order.findUnique({ where: { id: b.orderId } }),
      }));
      expect(seen.foreign).toBeNull();
      expect(seen.orders.every((o) => o.organizationId === orgA)).toBe(true);
    });

    it("concurrent requests for different tenants never see each other's context", async () => {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => {
          const org = i % 2 === 0 ? orgA : orgB;
          return tenantDb(org)
            .customer.findMany()
            .then((rows) => rows.every((r) => r.organizationId === org) && rows.length > 0);
        })
      );
      expect(results.every(Boolean)).toBe(true);
    });

    it("a context left over from one transaction doesn't leak to the next on a reused connection", async () => {
      await transaction(orgA, (tx) => tx.customer.findMany());
      const afterwards = await asTenant(null, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Customer"`));
      expect(Number(afterwards[0].n)).toBe(0);
    });
  });
});

describe("notifications: per-recipient row-level security", () => {
  let organizationId: string;
  let ownerId: string;
  let staffId: string;
  let noteId: string;

  /** Run raw SQL as the restricted role with an organization *and* a specific user context. */
  async function asUser<T>(organizationId: string, userId: string, fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
    return tenantRoot.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx as unknown as typeof prisma);
    });
  }

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Notification RLS Org" } });
    organizationId = org.id;
    const owner = await prisma.user.create({ data: { email: "notif-rls-owner@iso.example", passwordHash: "x", name: "Owner" } });
    const staff = await prisma.user.create({ data: { email: "notif-rls-staff@iso.example", passwordHash: "x", name: "Staff" } });
    ownerId = owner.id;
    staffId = staff.id;
    const note = await prisma.notification.create({
      data: { organizationId, userId: ownerId, kind: "TEST", title: "For the owner only", dedupeKey: "notif-rls-1" },
    });
    noteId = note.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("the recipient can read their own notification", async () => {
    const rows = await asUser(organizationId, ownerId, (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Notification" WHERE "id" = '${noteId}'`));
    expect(rows).toHaveLength(1);
  });

  it("another member of the SAME organization cannot read it, even with the right organizationId", async () => {
    const rows = await asUser(organizationId, staffId, (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Notification" WHERE "id" = '${noteId}'`));
    expect(rows).toHaveLength(0);
  });

  it("a query with no user context sees no notifications at all (fails closed), even with the right organization", async () => {
    const rows = await tenantRoot.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      // app.user_id deliberately left unset.
      return tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Notification" WHERE "id" = '${noteId}'`);
    });
    expect(rows).toHaveLength(0);
  });

  it("another member cannot mark it read, even by id", async () => {
    const updated = await asUser(organizationId, staffId, (tx) => tx.$executeRawUnsafe(`UPDATE "Notification" SET "readAt" = now() WHERE "id" = '${noteId}'`));
    expect(updated).toBe(0);
    const stillUnread = await asUser(organizationId, ownerId, (tx) => tx.$queryRawUnsafe<{ readAt: Date | null }[]>(`SELECT "readAt" FROM "Notification" WHERE "id" = '${noteId}'`));
    expect(stillUnread[0].readAt).toBeNull();
  });

  it("creating a notification for someone else only needs the organization context (the writer isn't the recipient)", async () => {
    const created = await tenantRoot.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      // app.user_id deliberately left unset — notify() writes from inside a plain
      // org-scoped transaction(), on behalf of recipients who are not the actor.
      return tx.$executeRawUnsafe(
        `INSERT INTO "Notification" ("id","organizationId","userId","kind","title","dedupeKey") VALUES ('notif-rls-written-for-staff','${organizationId}','${staffId}','TEST','Written for staff','notif-rls-2')`
      );
    });
    expect(created).toBe(1);
    const staffSeesIt = await asUser(organizationId, staffId, (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Notification" WHERE "id" = 'notif-rls-written-for-staff'`));
    expect(staffSeesIt).toHaveLength(1);
  });
});

describe("memberships", () => {
  let org1: string;
  let org2: string;
  let userId: string;

  beforeAll(async () => {
    org1 = (await prisma.organization.create({ data: { name: "Member Org 1" } })).id;
    org2 = (await prisma.organization.create({ data: { name: "Member Org 2" } })).id;
    userId = (
      await prisma.user.create({
        data: { email: "multi@iso.example", passwordHash: "x", name: "Multi" },
      })
    ).id;
    await prisma.membership.create({ data: { userId, organizationId: org1, role: "OWNER", createdAt: new Date("2026-01-01") } });
    await prisma.membership.create({ data: { userId, organizationId: org2, role: "STAFF", createdAt: new Date("2026-02-01") } });
  });

  it("resolves the wanted organization with the role held *there*", async () => {
    expect(await resolveActiveMembership(userId, org1)).toMatchObject({ organizationId: org1, role: "OWNER" });
    expect(await resolveActiveMembership(userId, org2)).toMatchObject({ organizationId: org2, role: "STAFF" });
  });

  it("falls back to an organization the user does hold when asked for one they don't", async () => {
    const stranger = await prisma.organization.create({ data: { name: "Not Mine" } });
    const result = await resolveActiveMembership(userId, stranger.id);
    expect(result?.organizationId).toBe(org1); // never the stranger org
    expect((await resolveActiveMembership(userId, undefined))?.organizationId).toBe(org1);
  });

  it("a role change or removal takes effect on the very next resolution", async () => {
    await prisma.membership.update({ where: { userId_organizationId: { userId, organizationId: org2 } }, data: { role: "OWNER" } });
    expect(await resolveActiveMembership(userId, org2)).toMatchObject({ role: "OWNER" });

    await prisma.membership.delete({ where: { userId_organizationId: { userId, organizationId: org2 } } });
    expect((await resolveActiveMembership(userId, org2))?.organizationId).toBe(org1); // pushed back to the one they still have

    await prisma.membership.deleteMany({ where: { userId } });
    expect(await resolveActiveMembership(userId, org1)).toBeNull(); // no access anywhere → the session ends
  });

  it("one user holds at most one membership per organization", async () => {
    const user = await prisma.user.create({ data: { email: "dup@iso.example", passwordHash: "x", name: "Dup" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org1, role: "STAFF" } });
    await expect(prisma.membership.create({ data: { userId: user.id, organizationId: org1, role: "OWNER" } })).rejects.toThrow();
  });
});

describe("webhook routing to organizations", () => {
  it("routes by registered number, falls back only for a lone unregistered install, and otherwise refuses", async () => {
    const one = await prisma.organization.create({ data: { name: "Route One", whatsappPhoneNumberId: "iso-route-1" } });
    const two = await prisma.organization.create({ data: { name: "Route Two", whatsappPhoneNumberId: "iso-route-2" } });
    expect((await resolveOrganizationForWhatsApp("iso-route-1"))?.id).toBe(one.id);
    expect((await resolveOrganizationForWhatsApp("iso-route-2"))?.id).toBe(two.id);
    expect(await resolveOrganizationForWhatsApp("iso-route-3")).toBeNull();
    expect(await resolveOrganizationForWhatsApp(undefined)).toBeNull();
  });

  it("two organizations can't register the same WhatsApp number", async () => {
    await prisma.organization.create({ data: { name: "Dup Num 1", whatsappPhoneNumberId: "iso-dup-number" } });
    await expect(prisma.organization.create({ data: { name: "Dup Num 2", whatsappPhoneNumberId: "iso-dup-number" } })).rejects.toThrow();
  });
});

describe("source-level guard: tenant data is reached only through the tenant client", () => {
  // The database enforces isolation, but a query through the unscoped root client simply
  // returns nothing — a silent bug. So application code may use `prisma.<tenant model>`
  // nowhere; it must use tenantDb()/transaction(). Identity models are the exception.
  const IDENTITY = new Set(["user", "membership", "organization"]);
  const ALLOWED_FILES = new Set(["lib/prisma.ts", "lib/db.ts"]);

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("no application file reads or writes a tenant table through the root client", () => {
    const root = path.resolve(__dirname, "../src");
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const relative = path.relative(root, file).replaceAll(path.sep, "/");
      if (ALLOWED_FILES.has(relative)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bprisma\.(\$?\w+)/g)) {
        const target = match[1];
        if (!IDENTITY.has(target)) offenders.push(`${relative}: prisma.${target}`);
      }
    }
    expect(offenders, `use tenantDb(organizationId) or transaction() instead:\n${offenders.join("\n")}`).toEqual([]);
  });
});
