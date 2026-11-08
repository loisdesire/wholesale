import dotenv from "dotenv";
dotenv.config({ override: true });

import fs from "fs";
import path from "path";
import { PrismaClient, StockMovementReason } from "@prisma/client";
import { movementEffects } from "../src/lib/stock-effects";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

function ledgerRow(
  organizationId: string,
  productId: string,
  reason: StockMovementReason,
  quantityDelta: number,
  extra: { reference?: string; createdById?: string } = {}
) {
  return { organizationId, productId, reason, ...movementEffects(reason, quantityDelta), ...extra };
}

type ProductSpec = {
  sku: string;
  name: string;
  variantAttributes: Record<string, string>;
  priceCents: number;
  costCents?: number;
  moq?: number;
  unit?: string;
  initialStock: number;
  priceTiers?: { minQuantity: number; priceCents: number }[];
  imageFilename: string;
};

const PRODUCTS: ProductSpec[] = [
  {
    sku: "BAG-TOTE-TAN",
    name: "Structured Tote Bag",
    variantAttributes: {
      colour: "Tan / Rust Brown",
      material: "Vegan Leather",
      style: "Structured Shoulder Bag Crossbody with Top Handles",
      category: "Bags & Accessories",
    },
    priceCents: 2950000, // ₦29,500
    costCents: 1850000,
    moq: 1,
    unit: "piece",
    initialStock: 15,
    priceTiers: [
      { minQuantity: 5, priceCents: 2750000 },
      { minQuantity: 12, priceCents: 2500000 },
    ],
    imageFilename: "tan-tote-bag.jpg",
  },
  {
    sku: "SNKR-PASTEL-41",
    name: "Pastel Colour-Block Chunky Sneaker",
    variantAttributes: {
      colour: "Pastel Multicolour / Pink / Lavender / Mint",
      size: "41",
      style: "Colour-Block Chunky Platform Trainer Sneaker Athletic Footwear",
      category: "Footwear",
    },
    priceCents: 2650000, // ₦26,500
    costCents: 1700000,
    moq: 1,
    unit: "pair",
    initialStock: 20,
    priceTiers: [
      { minQuantity: 6, priceCents: 2400000 },
      { minQuantity: 12, priceCents: 2200000 },
    ],
    imageFilename: "pastel-colourblock-sneaker.jpg",
  },
  {
    sku: "HEEL-STIL-BLU-39",
    name: "Floral Pointed-Toe Stiletto Pump",
    variantAttributes: {
      colour: "Blue Floral Print Multi-colour",
      size: "39",
      style: "Pointed-toe Stiletto High Heel Pump Footwear",
      heelHeight: "4 inch Stiletto",
      category: "Footwear",
    },
    priceCents: 2200000, // ₦22,000
    costCents: 1400000,
    moq: 1,
    unit: "pair",
    initialStock: 18,
    imageFilename: "floral-stiletto-pump.jpg",
  },
  {
    sku: "JEANS-DNM-BLU-M",
    name: "Classic Blue Denim Jeans",
    variantAttributes: {
      colour: "Assorted Blue Washes",
      size: "M",
      style: "Folded Denim Jeans Stack, Heavyweight Cotton Denim Trousers",
      category: "Apparel",
    },
    priceCents: 1550000, // ₦15,500
    costCents: 950000,
    moq: 2,
    unit: "piece",
    initialStock: 35,
    priceTiers: [
      { minQuantity: 10, priceCents: 1350000 },
      { minQuantity: 25, priceCents: 1200000 },
    ],
    imageFilename: "blue-denim-jeans.jpg",
  },
  {
    sku: "WATCH-GOLD-01",
    name: "Luxury Gold-Tone Wristwatch",
    variantAttributes: {
      colour: "Gold-Tone",
      style: "White Dial Metal Bracelet Wristwatch Luxury Timepiece",
      category: "Accessories",
    },
    priceCents: 3500000, // ₦35,000
    costCents: 2100000,
    moq: 1,
    unit: "piece",
    initialStock: 12,
    priceTiers: [
      { minQuantity: 5, priceCents: 3100000 },
      { minQuantity: 10, priceCents: 2800000 },
    ],
    imageFilename: "gold-luxury-watch.jpg",
  },
  {
    sku: "DRESS-OFFSHLD-PLUM",
    name: "Plum Purple Off-Shoulder Gown",
    variantAttributes: {
      colour: "Plum Purple / Burgundy",
      size: "M",
      style: "Off-shoulder Fitted Evening Maxi Gown Dress Formal Wear",
      category: "Dresses",
    },
    priceCents: 4250000, // ₦42,500
    costCents: 2700000,
    moq: 1,
    unit: "piece",
    initialStock: 10,
    priceTiers: [
      { minQuantity: 5, priceCents: 3800000 },
    ],
    imageFilename: "plum-offshoulder-gown.jpg",
  },
  {
    sku: "DRESS-SEQUIN-SLV",
    name: "Silver Sequin Asymmetrical Mini Dress",
    variantAttributes: {
      colour: "Metallic Silver",
      size: "S",
      style: "Silver Sequin One-Shoulder Mini Dress Asymmetrical Neckline Party Cocktail Dress",
      category: "Dresses",
    },
    priceCents: 2850000, // ₦28,500
    costCents: 1750000,
    moq: 1,
    unit: "piece",
    initialStock: 16,
    priceTiers: [
      { minQuantity: 6, priceCents: 2500000 },
    ],
    imageFilename: "silver-sequin-dress.jpg",
  },
];

async function main() {
  console.log("🌸 Seeding Visual Wholesale Products for Adaeze Fashion Wholesale...");

  let org = await prisma.organization.findFirst({
    where: { name: { contains: "Adaeze" } },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Adaeze Fashion Wholesale",
        orderSeq: 1001,
        returnSeq: 1001,
        plan: "GROWTH",
        subscriptionStatus: "ACTIVE",
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      },
    });
    console.log(`Created organization: ${org.name}`);
  } else if (!org.telegramBotToken && process.env.TELEGRAM_BOT_TOKEN) {
    org = await prisma.organization.update({
      where: { id: org.id },
      data: { telegramBotToken: process.env.TELEGRAM_BOT_TOKEN },
    });
    console.log(`Linked Telegram token to Adaeze.`);
  }

  const owner = await prisma.user.findFirst({
    where: { email: "flomglobal@gmail.com" },
  });

  const testImagesDir = path.join(__dirname, "../public/test-images");

  for (const spec of PRODUCTS) {
    let product = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: spec.sku } },
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          organizationId: org.id,
          sku: spec.sku,
          name: spec.name,
          variantAttributes: spec.variantAttributes,
          priceCents: spec.priceCents,
          costCents: spec.costCents,
          moq: spec.moq ?? 1,
          unit: spec.unit ?? "piece",
          active: true,
          priceTiers: spec.priceTiers ? { create: spec.priceTiers } : undefined,
        },
      });

      if (spec.initialStock > 0) {
        await prisma.stockMovement.create({
          data: ledgerRow(org.id, product.id, StockMovementReason.INITIAL_STOCK, spec.initialStock, {
            reference: "SEED-STOCK-INIT",
            createdById: owner?.id,
          }),
        });
      }
      console.log(`  ➕ Created: ${product.sku} - ${product.name}`);
    } else {
      product = await prisma.product.update({
        where: { id: product.id },
        data: {
          name: spec.name,
          variantAttributes: spec.variantAttributes,
          priceCents: spec.priceCents,
          costCents: spec.costCents,
          moq: spec.moq ?? 1,
          unit: spec.unit ?? "piece",
          active: true,
        },
      });
      console.log(`  ✓ Updated: ${product.sku} - ${product.name}`);
    }

    // Attach image
    const imagePath = path.join(testImagesDir, spec.imageFilename);
    if (fs.existsSync(imagePath)) {
      const imageBytes = fs.readFileSync(imagePath);
      await prisma.productImage.deleteMany({ where: { productId: product.id } });
      await prisma.productImage.create({
        data: {
          productId: product.id,
          mimeType: "image/jpeg",
          data: imageBytes,
          sizeBytes: imageBytes.length,
          position: 0,
        },
      });
      console.log(`    🖼️ Attached image (${imageBytes.length} bytes) to ${product.sku}`);
    }
  }

  console.log("\n✅ Done! Visual catalogue fully seeded and ready for Telegram photo testing.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
