import { PrismaClient, StockMovementReason } from "@prisma/client";
import bcrypt from "bcryptjs";
import { movementEffects } from "../src/lib/stock-effects";

const prisma = new PrismaClient();

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
  await prisma.auditLog.deleteMany();
  await prisma.returnItem.deleteMany();
  await prisma.orderReturn.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.priceTier.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const org = await prisma.organization.create({
    data: { name: "Adaeze Fashion Wholesale", orderSeq: 1003, returnSeq: 1001 },
  });

  const ownerPasswordHash = await bcrypt.hash("owner-dev-pass", 10);
  const staffPasswordHash = await bcrypt.hash("staff-dev-pass", 10);

  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "flomglobal@gmail.com",
      passwordHash: ownerPasswordHash,
      name: "Lois Flomo",
      role: "OWNER",
    },
  });

  const staff = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "chidinma@adaezewholesale.ng",
      passwordHash: staffPasswordHash,
      name: "Chidinma Okafor",
      role: "STAFF",
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
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2348031234567", name: "Ngozi Eze", notes: "Prefers Ankara prints, usually orders in bulk for her boutique in Enugu." } }),
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2347098765432", name: "Funmilayo Adebayo", notes: "Reseller, Lagos. Pays via bank transfer, always sends screenshot." } }),
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2348123456789", name: "Blessing Nwachukwu" } }),
    prisma.customer.create({ data: { organizationId: org.id, phone: "+2349087654321", name: "Chioma Okonkwo", notes: "New customer, found us via Instagram." } }),
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
      { conversationId: convo1.id, direction: "OUTBOUND", sender: "AI", body: "Hi Ngozi! Confirming: 10x Ankara Two-Piece Set (Black, M) at ₦18,500 each, and 5x Ankara Two-Piece Set (Red, L) at ₦18,500 each. Total: ₦277,500. Shall I draft this order?", createdAt: hoursAgo(29.8) },
      { conversationId: convo1.id, direction: "INBOUND", sender: "CUSTOMER", body: "Yes please", createdAt: hoursAgo(29.5) },
      { conversationId: convo1.id, direction: "OUTBOUND", sender: "STAFF", body: "Order confirmed, payment received. Dispatching today.", createdAt: hoursAgo(27) },
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

  // A return waiting on the owner: two of Ngozi's black Ankara sets arrived with a split seam.
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
      refundCents: 2 * order1BlackItem.unitPriceCents,
      requestedById: staff.id,
      createdAt: hoursAgo(3),
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
      createdAt: hoursAgo(3),
    },
  });

  console.log("Seed complete.");
  console.log(`Owner login: ${owner.email} / owner-dev-pass`);
  console.log(`Staff login: ${staff.email} / staff-dev-pass`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
