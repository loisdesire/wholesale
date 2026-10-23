import { Prisma, UserRole } from "@prisma/client";
import { tenantDb, transaction, type DbClient } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { displayPhone, phoneKeyOf, phonesLookRelated } from "@/lib/phone";

type TxClient = Prisma.TransactionClient;

export class CustomerError extends Error {}

/** The phone number belongs to a customer we already have. Never overwrites or merges. */
export class DuplicateCustomerError extends CustomerError {
  constructor(
    public readonly existingId: string,
    public readonly existingName: string | null
  ) {
    super(`This phone number already belongs to ${existingName ?? "an existing customer"}.`);
  }
}

// Agreed prices change what a customer is charged, so — like refunds — they're
// an owner decision, enforced here rather than only hidden in the UI.
function requireOwner(role: UserRole, what: string) {
  if (role !== UserRole.OWNER) throw new CustomerError(`Only an owner can ${what}.`);
}

const MAX_MERGE_CHAIN = 10;

/**
 * The customer a record currently stands for: itself, or — if it was merged into
 * another — the surviving record (following the chain if that one was merged too).
 * Lets a message from a merged-away number land on the right person.
 */
export async function resolveSurvivor(
  client: DbClient,
  customer: Prisma.CustomerGetPayload<object>
): Promise<Prisma.CustomerGetPayload<object>> {
  let current = customer;
  for (let hops = 0; current.mergedIntoId && hops < MAX_MERGE_CHAIN; hops++) {
    current = await client.customer.findUniqueOrThrow({ where: { id: current.mergedIntoId } });
  }
  return current;
}

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Creates a customer, refusing (rather than duplicating) a phone number we already have in any format. */
export async function createCustomer(params: {
  organizationId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  actorId?: string;
}) {
  const key = phoneKeyOf(params.phone);
  if (!key) throw new CustomerError("Enter a valid phone number, including the country code if it isn't Nigerian.");

  const existing = await tenantDb(params.organizationId).customer.findUnique({
    where: { organizationId_phoneKey: { organizationId: params.organizationId, phoneKey: key } },
  });
  if (existing) {
    const survivor = await resolveSurvivor(tenantDb(params.organizationId), existing);
    throw new DuplicateCustomerError(survivor.id, survivor.name);
  }

  try {
    return await transaction(params.organizationId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId: params.organizationId,
          phone: displayPhone(key),
          phoneKey: key,
          name: cleanText(params.name),
          email: cleanText(params.email)?.toLowerCase() ?? null,
          notes: cleanText(params.notes),
        },
      });
      await recordAudit(
        {
          organizationId: params.organizationId,
          entity: "Customer",
          entityId: customer.id,
          action: "CUSTOMER_CREATED",
          actorId: params.actorId,
          after: { phone: customer.phone, name: customer.name },
        },
        tx
      );
      return customer;
    });
  } catch (err) {
    // Lost a race with a concurrent create of the same number.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await tenantDb(params.organizationId).customer.findUnique({
        where: { organizationId_phoneKey: { organizationId: params.organizationId, phoneKey: key } },
      });
      if (winner) {
        const survivor = await resolveSurvivor(tenantDb(params.organizationId), winner);
        throw new DuplicateCustomerError(survivor.id, survivor.name);
      }
    }
    throw err;
  }
}

/**
 * Finds the customer for an inbound message's sender, creating them if new.
 * Race-safe inside a transaction: a plain create that hits the unique key would
 * abort the whole Postgres transaction, so this inserts with ON CONFLICT DO
 * NOTHING semantics (skipDuplicates) and then reads the winner.
 */
export async function findOrCreateCustomerByPhoneTx(
  tx: TxClient,
  organizationId: string,
  rawPhone: string,
  name?: string | null
) {
  const key = phoneKeyOf(rawPhone) ?? (rawPhone.replace(/\D/g, "") || null);
  if (!key) throw new CustomerError("Message sender has no usable phone number.");
  const where = { organizationId_phoneKey: { organizationId, phoneKey: key } };

  const existing = await tx.customer.findUnique({ where });
  if (existing) return resolveSurvivor(tx, existing); // a merged-away number files under the survivor

  await tx.customer.createMany({
    data: [{ organizationId, phone: displayPhone(key), phoneKey: key, name: cleanText(name) }],
    skipDuplicates: true,
  });
  return resolveSurvivor(tx, await tx.customer.findUniqueOrThrow({ where }));
}

async function loadCustomer(tx: TxClient, organizationId: string, customerId: string) {
  const customer = await tx.customer.findFirst({ where: { id: customerId, organizationId } });
  if (!customer) throw new CustomerError("Customer not found.");
  return customer;
}

export async function updateCustomer(params: {
  organizationId: string;
  customerId: string;
  actorId: string;
  name: string | null;
  email: string | null;
  notes: string | null;
}) {
  return transaction(params.organizationId, async (tx) => {
    const before = await loadCustomer(tx, params.organizationId, params.customerId);
    const next = {
      name: cleanText(params.name),
      email: cleanText(params.email)?.toLowerCase() ?? null,
      notes: cleanText(params.notes),
    };
    if (next.email && !/^\S+@\S+\.\S+$/.test(next.email)) throw new CustomerError("That email address doesn't look right.");

    const updated = await tx.customer.update({ where: { id: before.id }, data: next });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: before.id,
        action: "CUSTOMER_UPDATED",
        actorId: params.actorId,
        before: { name: before.name, email: before.email, notes: before.notes },
        after: next,
      },
      tx
    );
    return updated;
  });
}

export async function addCustomerAddress(params: {
  organizationId: string;
  customerId: string;
  actorId: string;
  label?: string | null;
  text: string;
}) {
  const text = params.text.trim();
  if (!text) throw new CustomerError("Enter the address.");
  return transaction(params.organizationId, async (tx) => {
    const customer = await loadCustomer(tx, params.organizationId, params.customerId);
    const hasAny = (await tx.customerAddress.count({ where: { customerId: customer.id } })) > 0;
    const address = await tx.customerAddress.create({
      data: {
        organizationId: params.organizationId,
        customerId: customer.id,
        label: cleanText(params.label),
        text,
        isDefault: !hasAny, // the first address is the default
      },
    });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: customer.id,
        action: "ADDRESS_ADDED",
        actorId: params.actorId,
        after: { label: address.label, text },
      },
      tx
    );
    return address;
  });
}

export async function setDefaultAddress(params: {
  organizationId: string;
  customerId: string;
  addressId: string;
  actorId: string;
}) {
  return transaction(params.organizationId, async (tx) => {
    const customer = await loadCustomer(tx, params.organizationId, params.customerId);
    const address = await tx.customerAddress.findFirst({ where: { id: params.addressId, customerId: customer.id } });
    if (!address) throw new CustomerError("Address not found.");
    await tx.customerAddress.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
    await tx.customerAddress.update({ where: { id: address.id }, data: { isDefault: true } });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: customer.id,
        action: "DEFAULT_ADDRESS_CHANGED",
        actorId: params.actorId,
        after: { text: address.text },
      },
      tx
    );
  });
}

export async function removeCustomerAddress(params: {
  organizationId: string;
  customerId: string;
  addressId: string;
  actorId: string;
}) {
  return transaction(params.organizationId, async (tx) => {
    const customer = await loadCustomer(tx, params.organizationId, params.customerId);
    const address = await tx.customerAddress.findFirst({ where: { id: params.addressId, customerId: customer.id } });
    if (!address) throw new CustomerError("Address not found.");
    await tx.customerAddress.delete({ where: { id: address.id } });
    if (address.isDefault) {
      const next = await tx.customerAddress.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: "asc" } });
      if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: customer.id,
        action: "ADDRESS_REMOVED",
        actorId: params.actorId,
        before: { text: address.text },
      },
      tx
    );
  });
}

/** Sets the price agreed with this customer for a product. New orders use it; existing orders keep theirs. */
export async function setCustomerPrice(params: {
  organizationId: string;
  customerId: string;
  productId: string;
  priceCents: number;
  actorId: string;
  actorRole: UserRole;
}) {
  requireOwner(params.actorRole, "set an agreed price");
  if (!Number.isInteger(params.priceCents) || params.priceCents <= 0) {
    throw new CustomerError("The agreed price must be greater than zero.");
  }
  return transaction(params.organizationId, async (tx) => {
    const customer = await loadCustomer(tx, params.organizationId, params.customerId);
    const product = await tx.product.findFirst({ where: { id: params.productId, organizationId: params.organizationId } });
    if (!product) throw new CustomerError("Product not found.");

    const existing = await tx.customerPrice.findUnique({
      where: { customerId_productId: { customerId: customer.id, productId: product.id } },
    });
    const saved = await tx.customerPrice.upsert({
      where: { customerId_productId: { customerId: customer.id, productId: product.id } },
      create: {
        organizationId: params.organizationId,
        customerId: customer.id,
        productId: product.id,
        priceCents: params.priceCents,
      },
      update: { priceCents: params.priceCents },
    });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: customer.id,
        action: "CUSTOM_PRICE_SET",
        actorId: params.actorId,
        before: existing ? { sku: product.sku, priceCents: existing.priceCents } : null,
        after: { sku: product.sku, priceCents: params.priceCents },
      },
      tx
    );
    return saved;
  });
}

export async function removeCustomerPrice(params: {
  organizationId: string;
  customerId: string;
  productId: string;
  actorId: string;
  actorRole: UserRole;
}) {
  requireOwner(params.actorRole, "remove an agreed price");
  return transaction(params.organizationId, async (tx) => {
    const customer = await loadCustomer(tx, params.organizationId, params.customerId);
    const existing = await tx.customerPrice.findUnique({
      where: { customerId_productId: { customerId: customer.id, productId: params.productId } },
      include: { product: true },
    });
    if (!existing) throw new CustomerError("No agreed price to remove.");
    await tx.customerPrice.delete({ where: { id: existing.id } });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: customer.id,
        action: "CUSTOM_PRICE_REMOVED",
        actorId: params.actorId,
        before: { sku: existing.product.sku, priceCents: existing.priceCents },
      },
      tx
    );
  });
}

/** The agreed prices for one customer, keyed by product id. */
export async function getCustomerPriceMap(
  organizationId: string,
  customerId: string,
  productIds: string[],
  client: DbClient
) {
  const rows = await client.customerPrice.findMany({
    where: { organizationId, customerId, productId: { in: productIds } },
  });
  return new Map(rows.map((r) => [r.productId, r.priceCents]));
}

export type DuplicateCandidate = {
  customer: { id: string; name: string | null; phone: string };
  reasons: string[];
};

/**
 * Other customers who might be the same person. This only *surfaces* them for a
 * human to look at — it never merges anything, and a shared name on its own is
 * deliberately labelled weak because different people share names.
 */
export async function findPossibleDuplicates(organizationId: string, customerId: string): Promise<DuplicateCandidate[]> {
  const db = tenantDb(organizationId);
  const customer = await db.customer.findFirst({ where: { id: customerId, organizationId } });
  if (!customer) throw new CustomerError("Customer not found.");

  const conditions: Prisma.CustomerWhereInput[] = [];
  if (customer.phoneKey.length >= 9) conditions.push({ phoneKey: { endsWith: customer.phoneKey.slice(-9) } });
  if (customer.email) conditions.push({ email: { equals: customer.email, mode: "insensitive" } });
  if (customer.name) conditions.push({ name: { equals: customer.name.trim(), mode: "insensitive" } });
  if (conditions.length === 0) return [];

  const others = await db.customer.findMany({
    where: { organizationId, id: { not: customer.id }, mergedIntoId: null, OR: conditions },
    take: 20,
  });

  return others
    .map((other) => {
      const reasons: string[] = [];
      if (phonesLookRelated(customer.phoneKey, other.phoneKey)) {
        reasons.push("Phone number matches apart from the country code or formatting");
      }
      if (customer.email && other.email?.toLowerCase() === customer.email) reasons.push("Same email address");
      if (customer.name && other.name?.trim().toLowerCase() === customer.name.trim().toLowerCase()) {
        reasons.push("Same name (weak signal — could be different people)");
      }
      return { customer: { id: other.id, name: other.name, phone: other.phone }, reasons };
    })
    .filter((c) => c.reasons.length > 0);
}
