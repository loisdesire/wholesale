import { PrismaClient, StockMovementReason } from "@prisma/client";
import bcrypt from "bcryptjs";
import { movementEffects } from "../src/lib/stock-effects";
import { phoneKeyOf } from "../src/lib/phone";

// The seed writes tenant tables directly, with no tenant context, so it must connect as
// the database owner (DIRECT_URL) — the application's restricted role can't, by design.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

// Builds a ledger row the same way the app does, so seeded stock figures
// (physical / reserved / damaged) obey the same rules as real movements.
function ledgerRow(
  organizationId: string,
  productId: string,
  reason: StockMovementReason,
  quantityDelta: number,
  extra: { reference?: string; createdById?: string } = {}
) {
  return { organizationId, productId, reason, ...movementEffects(reason, quantityDelta), ...extra };
}

async function main() {
  await prisma.customerMerge.deleteMany();
  await prisma.customerPrice.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.shipmentItem.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.returnItem.deleteMany();
  await prisma.orderReturn.deleteMany();
  await prisma.subscriptionPayment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.priceTier.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Paying, active subscriber — demos the "already paying" billing state.
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  const org = await prisma.organization.create({
    data: {
      name: "Adaeze Fashion Wholesale",
      orderSeq: 1003,
      returnSeq: 1001,
      // The WhatsApp business number this organization receives on (Meta's phone_number_id).
      whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "100000000000001",
      plan: "GROWTH",
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: periodEnd,
    },
  });

  await prisma.subscriptionPayment.create({
    data: {
      organizationId: org.id,
      plan: "GROWTH",
      amountCents: 3_500_000,
      periodStart,
      periodEnd,
      providerReference: `subpay_seed_${org.id}_growth`,
    },
  });

  const ownerPasswordHash = await bcrypt.hash("owner-dev-pass", 10);
  const staffPasswordHash = await bcrypt.hash("staff-dev-pass", 10);

  const owner = await prisma.user.create({
    data: {
      email: "flomglobal@gmail.com",
      passwordHash: ownerPasswordHash,
      name: "Lois Flomo",
      memberships: { create: { organizationId: org.id, role: "OWNER" } },
    },
  });

  const staff = await prisma.user.create({
    data: {
      email: "chidinma@adaezewholesale.ng",
      passwordHash: staffPasswordHash,
      name: "Chidinma Okafor",
      memberships: { create: { organizationId: org.id, role: "STAFF" } },
    },
  });

  type ProductSeed = {
    sku: string;
    name: string;
    variantAttributes: Record<string, string>;
    priceCents: number;
    costCents?: number;
    moq?: number;
    unit?: string;
    initialStock: number;
    priceTiers?: { minQuantity: number; priceCents: number }[];
  };

  // Wholesale bulk pricing on the Ankara two-piece line (and a bulk MOQ on
  // the cheap headwraps) is seeded deliberately — it's the product/line real
  // wholesale customers actually negotiate quantity breaks on, and gives the
  // catalogue/AI-matching features real data to demonstrate against.
  const ankaraTiers = [
    { minQuantity: 10, priceCents: 1700000 },
    { minQuantity: 24, priceCents: 1600000 },
  ];

  const products: ProductSeed[] = [
    { sku: "ANK-2PC-BLK-M", name: "Ankara Two-Piece Set", variantAttributes: { colour: "Black", size: "M" }, priceCents: 1850000, costCents: 1100000, initialStock: 24, priceTiers: ankaraTiers },
    { sku: "ANK-2PC-BLK-L", name: "Ankara Two-Piece Set", variantAttributes: { colour: "Black", size: "L" }, priceCents: 1850000, costCents: 1100000, initialStock: 18, priceTiers: ankaraTiers },
    { sku: "ANK-2PC-RED-M", name: "Ankara Two-Piece Set", variantAttributes: { colour: "Red", size: "M" }, priceCents: 1850000, costCents: 1100000, initialStock: 15, priceTiers: ankaraTiers },
    { sku: "ANK-2PC-RED-L", name: "Ankara Two-Piece Set", variantAttributes: { colour: "Red", size: "L" }, priceCents: 1850000, costCents: 1100000, initialStock: 9, priceTiers: ankaraTiers },
    { sku: "LACE-GOWN-GLD-M", name: "Lace Evening Gown", variantAttributes: { colour: "Gold", size: "M" }, priceCents: 4250000, costCents: 2700000, initialStock: 6 },
    { sku: "LACE-GOWN-GLD-L", name: "Lace Evening Gown", variantAttributes: { colour: "Gold", size: "L" }, priceCents: 4250000, costCents: 2700000, initialStock: 4 },
    { sku: "LACE-GOWN-WHT-M", name: "Lace Evening Gown", variantAttributes: { colour: "White", size: "M" }, priceCents: 4250000, costCents: 2700000, initialStock: 3 },
    { sku: "DENIM-JKT-BLU-S", name: "Oversized Denim Jacket", variantAttributes: { colour: "Blue", size: "S" }, priceCents: 1550000, costCents: 950000, initialStock: 30 },
    { sku: "DENIM-JKT-BLU-M", name: "Oversized Denim Jacket", variantAttributes: { colour: "Blue", size: "M" }, priceCents: 1550000, costCents: 950000, initialStock: 22 },
    { sku: "DENIM-JKT-BLK-M", name: "Oversized Denim Jacket", variantAttributes: { colour: "Black", size: "M" }, priceCents: 1550000, costCents: 950000, initialStock: 0 },
    { sku: "HEEL-STRP-BLK-39", name: "Strappy Block Heel", variantAttributes: { colour: "Black", size: "39" }, priceCents: 2200000, costCents: 1400000, unit: "pair", initialStock: 12 },
    { sku: "HEEL-STRP-BLK-40", name: "Strappy Block Heel", variantAttributes: { colour: "Black", size: "40" }, priceCents: 2200000, costCents: 1400000, unit: "pair", initialStock: 8 },
    { sku: "HEEL-STRP-NUDE-38", name: "Strappy Block Heel", variantAttributes: { colour: "Nude", size: "38" }, priceCents: 2200000, costCents: 1400000, unit: "pair", initialStock: 5 },
    { sku: "SNKR-CHUNK-WHT-41", name: "Chunky Sole Sneaker", variantAttributes: { colour: "White", size: "41" }, priceCents: 2650000, costCents: 1700000, unit: "pair", initialStock: 14 },
    { sku: "SNKR-CHUNK-WHT-42", name: "Chunky Sole Sneaker", variantAttributes: { colour: "White", size: "42" }, priceCents: 2650000, costCents: 1700000, unit: "pair", initialStock: 11 },
    { sku: "HEADWRAP-ANK-01", name: "Ankara Headwrap", variantAttributes: { colour: "Assorted" }, priceCents: 350000, costCents: 180000, moq: 5, initialStock: 60 },
    { sku: "BAG-TOTE-TAN", name: "Structured Tote Bag", variantAttributes: { colour: "Tan" }, priceCents: 2950000, costCents: 1850000, initialStock: 10 },
    { sku: "BAG-TOTE-BLK", name: "Structured Tote Bag", variantAttributes: { colour: "Black" }, priceCents: 2950000, costCents: 1850000, initialStock: 7 },
    { sku: "CAMI-SET-SAGE-S", name: "Satin Cami Set", variantAttributes: { colour: "Sage", size: "S" }, priceCents: 1650000, costCents: 1000000, initialStock: 20 },
    { sku: "CAMI-SET-SAGE-M", name: "Satin Cami Set", variantAttributes: { colour: "Sage", size: "M" }, priceCents: 1650000, costCents: 1000000, initialStock: 16 },
  ];

  const createdProducts: Awaited<ReturnType<typeof prisma.product.create>>[] = [];
  for (const p of products) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: p.sku,
        name: p.name,
        variantAttributes: p.variantAttributes,
        priceCents: p.priceCents,
        costCents: p.costCents,
        moq: p.moq ?? 1,
        unit: p.unit ?? "piece",
        active: true,
        priceTiers: p.priceTiers ? { create: p.priceTiers } : undefined,
      },
    });
    if (p.initialStock > 0) {
      await prisma.stockMovement.create({
        data: ledgerRow(org.id, product.id, StockMovementReason.INITIAL_STOCK, p.initialStock, {
          reference: "SEED-OPENING-BALANCE",
          createdById: owner.id,
        }),
      });
    }
    createdProducts.push(product);
  }
  const bySku = (sku: string) => createdProducts.find((p) => p.sku === sku)!;

  const customers = await Promise.all([
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2348031234567", phoneKey: phoneKeyOf("+2348031234567")!, name: "Ngozi Eze", notes: "Prefers Ankara prints, usually orders in bulk for her boutique in Enugu." } }),
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2347098765432", phoneKey: phoneKeyOf("+2347098765432")!, name: "Funmilayo Adebayo", notes: "Reseller, Lagos. Pays via bank transfer, always sends screenshot." } }),
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2348123456789", phoneKey: phoneKeyOf("+2348123456789")!, name: "Blessing Nwachukwu" } }),
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2349087654321", phoneKey: phoneKeyOf("+2349087654321")!, name: "Chioma Okonkwo", notes: "New customer, found us via Instagram." } }),
  ]);

  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000);

  // Conversation 1 — resolved order, fulfilled, paid.
  const convo1 = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      customerId: customers[0].id,
      channel: "WHATSAPP",
      status: "RESOLVED",
      assignedToId: staff.id,
      lastMessageAt: hoursAgo(26),
      createdAt: hoursAgo(30),
    },
  });
  await prisma.message.createMany({
    data: [
      { conversationId: convo1.id, direction: "INBOUND", sender: "CUSTOMER", body: "Good day, I need 10 Ankara two piece, black, size M and 5 in red, size L", createdAt: hoursAgo(30) },
      { conversationId: convo1.id, direction: "OUTBOUND", sender: "AI", body: "Hi Ngozi! Confirming: 10x Ankara Two-Piece Set (Black, M) at ₦18,500 each, and 5x Ankara Two-Piece Set (Red, L) at ₦18,500 each. Total: ₦277,500. Shall I draft this order?", createdAt: hoursAgo(29.8), deliveryStatus: "READ", deliveryStatusAt: hoursAgo(29.7) },
      { conversationId: convo1.id, direction: "INBOUND", sender: "CUSTOMER", body: "Yes please", createdAt: hoursAgo(29.5) },
      { conversationId: convo1.id, direction: "OUTBOUND", sender: "STAFF", body: "Order confirmed, payment received. Dispatching today.", createdAt: hoursAgo(27), deliveryStatus: "FAILED", deliveryStatusAt: hoursAgo(26.9), deliveryError: "Recipient number is not on WhatsApp." },
    ],
  });
  const order1 = await prisma.order.create({
    data: {
      organizationId: org.id,
      reference: "ORD-1001",
      customerId: customers[0].id,
      conversationId: convo1.id,
      status: "FULFILLED",
      totalCents: 10 * 1850000 + 5 * 1850000,
      createdById: staff.id,
      confirmedAt: hoursAgo(29.4),
      paidAt: hoursAgo(28),
      fulfilledAt: hoursAgo(26),
      createdAt: hoursAgo(29.8),
    },
  });
  await prisma.orderItem.createMany({
    data: [
      { orderId: order1.id, productId: bySku("ANK-2PC-BLK-M").id, variantLabel: "Black / M", quantity: 10, unitPriceCents: 1850000 },
      { orderId: order1.id, productId: bySku("ANK-2PC-RED-L").id, variantLabel: "Red / L", quantity: 5, unitPriceCents: 1850000 },
    ],
  });
  // ORD-1001 shipped in one go.
  const order1ItemRows = await prisma.orderItem.findMany({ where: { orderId: order1.id } });
  await prisma.shipment.create({
    data: {
      organizationId: org.id,
      orderId: order1.id,
      reference: `${order1.reference}/1`,
      carrier: "GIG Logistics",
      trackingReference: "GIG-558210",
      createdById: staff.id,
      createdAt: hoursAgo(26),
      items: { create: order1ItemRows.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
    },
  });
  // ORD-1001 was reserved at confirmation, then shipped at fulfilment.
  const order1Lines = [
    { sku: "ANK-2PC-BLK-M", quantity: 10 },
    { sku: "ANK-2PC-RED-L", quantity: 5 },
  ];
  await prisma.stockMovement.createMany({
    data: order1Lines.flatMap((line) => [
      ledgerRow(org.id, bySku(line.sku).id, StockMovementReason.SALE_RESERVED, -line.quantity, { reference: order1.reference, createdById: staff.id }),
      ledgerRow(org.id, bySku(line.sku).id, StockMovementReason.SALE_FULFILLED, -line.quantity, { reference: order1.reference, createdById: staff.id }),
    ]),
  });

  // Conversation 2 — awaiting staff confirmation on a draft order (stock is short).
  const convo2 = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      customerId: customers[1].id,
      channel: "WHATSAPP",
      status: "AWAITING_STAFF",
      assignedToId: staff.id,
      lastMessageAt: hoursAgo(2),
      createdAt: hoursAgo(3),
    },
  });
  await prisma.message.createMany({
    data: [
      { conversationId: convo2.id, direction: "INBOUND", sender: "CUSTOMER", body: "Hi do you have the lace gown in gold, size L? I need 8 pieces", createdAt: hoursAgo(3) },
      { conversationId: convo2.id, direction: "OUTBOUND", sender: "AI", body: "We have 4 in stock for Lace Evening Gown (Gold, L) — not enough for 8. I can offer 4 now plus notify you when more arrive, or suggest Gold/M (3 left) or White/M (3 left) as alternatives. A staff member will follow up to confirm what works.", createdAt: hoursAgo(2.9) },
      { conversationId: convo2.id, direction: "INBOUND", sender: "CUSTOMER", body: "Ok let me know, I'll take the 4 for now", createdAt: hoursAgo(2) },
    ],
  });
  const order2 = await prisma.order.create({
    data: {
      organizationId: org.id,
      reference: "ORD-1002",
      customerId: customers[1].id,
      conversationId: convo2.id,
      status: "DRAFT",
      totalCents: 4 * 4250000,
      createdById: owner.id,
      createdAt: hoursAgo(2),
    },
  });
  await prisma.orderItem.create({
    data: { orderId: order2.id, productId: bySku("LACE-GOWN-GLD-L").id, variantLabel: "Gold / L", quantity: 4, unitPriceCents: 4250000 },
  });

  // Conversation 3 — AI handling, new enquiry, ambiguous product match.
  const convo3 = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      customerId: customers[2].id,
      channel: "WHATSAPP",
      status: "AI_HANDLING",
      lastMessageAt: hoursAgo(0.3),
      createdAt: hoursAgo(0.5),
    },
  });
  await prisma.message.createMany({
    data: [
      { conversationId: convo3.id, direction: "INBOUND", sender: "CUSTOMER", body: "How much is the heels and the sneakers", createdAt: hoursAgo(0.5) },
      { conversationId: convo3.id, direction: "OUTBOUND", sender: "AI", body: "We have two heel styles and one sneaker style — could you tell me which colour/size, or should I list all options with prices?", createdAt: hoursAgo(0.3) },
    ],
  });

  // Conversation 4 — new, unread.
  const convo4 = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      customerId: customers[3].id,
      channel: "WHATSAPP",
      status: "NEW",
      lastMessageAt: hoursAgo(0.05),
      createdAt: hoursAgo(0.05),
    },
  });
  await prisma.message.create({
    data: { conversationId: convo4.id, direction: "INBOUND", sender: "CUSTOMER", body: "Hello, I saw your tote bags on Instagram, do you sell wholesale?", createdAt: hoursAgo(0.05) },
  });

  // Order placed directly (no WhatsApp conversation) — confirmed, awaiting payment.
  const order3 = await prisma.order.create({
    data: {
      organizationId: org.id,
      reference: "ORD-1003",
      customerId: customers[2].id,
      status: "CONFIRMED",
      totalCents: 6 * 2650000,
      createdById: staff.id,
      confirmedAt: hoursAgo(5),
      createdAt: hoursAgo(5.2),
    },
  });
  await prisma.orderItem.create({
    data: { orderId: order3.id, productId: bySku("SNKR-CHUNK-WHT-41").id, variantLabel: "White / 41", quantity: 6, unitPriceCents: 2650000 },
  });
  await prisma.stockMovement.create({
    data: ledgerRow(org.id, bySku("SNKR-CHUNK-WHT-41").id, StockMovementReason.SALE_RESERVED, -6, { reference: order3.reference, createdById: staff.id }),
  });

  await prisma.auditLog.createMany({
    data: [
      { organizationId: org.id, entity: "Order", entityId: order1.id, action: "ORDER_FULFILLED", actorId: staff.id, before: { status: "PAID" }, after: { status: "FULFILLED" }, createdAt: hoursAgo(26) },
      { organizationId: org.id, entity: "Order", entityId: order1.id, action: "PAYMENT_MARKED_PAID", actorId: staff.id, before: { status: "CONFIRMED" }, after: { status: "PAID" }, createdAt: hoursAgo(28) },
      { organizationId: org.id, entity: "Order", entityId: order3.id, action: "ORDER_CONFIRMED", actorId: staff.id, before: { status: "DRAFT" }, after: { status: "CONFIRMED" }, createdAt: hoursAgo(5) },
    ],
  });

  // A return waiting on the owner: two of Ngozi's black Ankara sets arrived with a split
  // seam. Left at 30 hours so it reads as overdue on Operations (past the 24h warning
  // threshold, short of the 72h critical one) rather than just-requested.
  const order1BlackItem = await prisma.orderItem.findFirstOrThrow({
    where: { orderId: order1.id, productId: bySku("ANK-2PC-BLK-M").id },
  });
  const seededReturn = await prisma.orderReturn.create({
    data: {
      organizationId: org.id,
      reference: "RET-1001",
      orderId: order1.id,
      customerId: customers[0].id,
      reason: "Seam came apart on two pieces",
      valueCents: 2 * order1BlackItem.unitPriceCents,
      refundCents: 2 * order1BlackItem.unitPriceCents,
      requestedById: staff.id,
      createdAt: hoursAgo(30),
      items: { create: [{ orderItemId: order1BlackItem.id, quantity: 2, condition: "DAMAGED" }] },
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      entity: "Order",
      entityId: order1.id,
      action: "RETURN_REQUESTED",
      actorId: staff.id,
      after: { return: seededReturn.reference, refundCents: seededReturn.refundCents, reason: seededReturn.reason },
      createdAt: hoursAgo(30),
    },
  });

  // Phase 3 data: an address and an agreed price for Ngozi, and a lookalike record
  // (same line, UK format) so the "possible duplicate" warning has something to find.
  await prisma.customerAddress.create({
    data: { organizationId: org.id, customerId: customers[0].id, label: "Shop", text: "Shop 14, Ogbete Main Market, Enugu", isDefault: true },
  });
  await prisma.customerPrice.create({
    data: { organizationId: org.id, customerId: customers[0].id, productId: bySku("ANK-2PC-BLK-M").id, priceCents: 1750000 },
  });
  await prisma.customer.create({
    data: {
      organizationId: org.id,
      phone: "+448031234567",
      phoneKey: phoneKeyOf("+448031234567")!,
      name: "Ngozi Eze",
      notes: "Probably Ngozi's UK number — check before merging anything.",
    },
  });

  // Phase 4 data: assignment, overdue work and notifications, so Operations has
  // something real to show on first login.
  await prisma.order.update({ where: { id: order2.id }, data: { assignedToId: staff.id } });
  await prisma.conversation.update({ where: { id: convo2.id }, data: { assignedToId: staff.id } });
  await prisma.orderReturn.update({ where: { id: seededReturn.id }, data: { assignedToId: staff.id } });
  // ORD-1003 confirmed 5 hours ago is fine; back-date it so it reads as overdue (and past its due date).
  await prisma.order.update({
    where: { id: order3.id },
    data: { confirmedAt: hoursAgo(24 * 3), createdAt: hoursAgo(24 * 3 + 0.2), dueAt: hoursAgo(12) },
  });
  await prisma.notification.createMany({
    data: [
      {
        organizationId: org.id,
        userId: owner.id,
        kind: "RETURN_REQUESTED",
        title: `Return ${seededReturn.reference} needs a decision`,
        body: seededReturn.reason,
        href: `/orders/${order1.id}`,
        dedupeKey: `return-requested:${seededReturn.id}`,
        createdAt: hoursAgo(30),
      },
      {
        organizationId: org.id,
        userId: staff.id,
        kind: "ASSIGNED",
        title: "You were assigned order ORD-1002",
        href: `/orders/${order2.id}`,
        dedupeKey: `assigned:order:${order2.id}:${staff.id}:seed`,
        createdAt: hoursAgo(2),
      },
    ],
  });

  // A second organization, to show tenants are isolated: its own catalogue, customers and
  // order. Lois belongs to it too — as STAFF, so switching organizations also changes what
  // she may do — and Ife owns it and can't see anything of Adaeze's.
  const spice = await prisma.organization.create({
    data: {
      name: "Lagos Spice Traders",
      orderSeq: 1001,
      whatsappPhoneNumberId: "100000000000002",
      plan: "STARTER",
      subscriptionStatus: "TRIALING",
      trialEndsAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
    },
  });
  const ife = await prisma.user.create({
    data: {
      email: "ife@spicetraders.ng",
      passwordHash: await bcrypt.hash("spice-dev-pass", 10),
      name: "Ife Bello",
      memberships: { create: { organizationId: spice.id, role: "OWNER" } },
    },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: spice.id, role: "STAFF" } });

  const spiceProducts = await Promise.all(
    [
      { sku: "SPC-PEPPER-1KG", name: "Ground Pepper 1kg", priceCents: 650000, stock: 120, unit: "bag" },
      { sku: "SPC-GINGER-1KG", name: "Dried Ginger 1kg", priceCents: 480000, stock: 80, unit: "bag" },
      { sku: "SPC-CURRY-500G", name: "Curry Powder 500g", priceCents: 310000, stock: 200, unit: "pack" },
      { sku: "SPC-TURMERIC-1KG", name: "Turmeric 1kg", priceCents: 520000, stock: 0, unit: "bag" },
    ].map(async (p) => {
      const product = await prisma.product.create({
        data: { organizationId: spice.id, sku: p.sku, name: p.name, priceCents: p.priceCents, unit: p.unit, moq: 5 },
      });
      if (p.stock > 0) {
        await prisma.stockMovement.create({
          data: ledgerRow(spice.id, product.id, StockMovementReason.INITIAL_STOCK, p.stock, {
            reference: "SEED-OPENING-BALANCE",
            createdById: ife.id,
          }),
        });
      }
      return product;
    })
  );
  const spiceCustomer = await prisma.customer.create({
    data: {
      organizationId: spice.id,
      phone: "+2348020001111",
      phoneKey: phoneKeyOf("+2348020001111")!,
      name: "Mama Tunde Provisions",
      notes: "Buys pepper and curry weekly.",
    },
  });
  await prisma.customer.create({
    data: { organizationId: spice.id, phone: "+2348020002222", phoneKey: phoneKeyOf("+2348020002222")!, name: "Okoro Stores" },
  });
  const spiceOrder = await prisma.order.create({
    data: {
      organizationId: spice.id,
      reference: "ORD-1001",
      customerId: spiceCustomer.id,
      status: "CONFIRMED",
      totalCents: 20 * 650000,
      createdById: ife.id,
      confirmedAt: new Date(),
      items: { create: [{ productId: spiceProducts[0].id, variantLabel: null, quantity: 20, unitPriceCents: 650000 }] },
    },
  });
  await prisma.stockMovement.create({
    data: ledgerRow(spice.id, spiceProducts[0].id, StockMovementReason.SALE_RESERVED, -20, {
      reference: spiceOrder.reference,
      createdById: ife.id,
    }),
  });

  console.log("Seed complete.");
  console.log(`Owner login: ${owner.email} / owner-dev-pass`);
  console.log(`Staff login: ${staff.email} / staff-dev-pass`);
  console.log(`Second organization (owner): ife@spicetraders.ng / spice-dev-pass`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
