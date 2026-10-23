"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, StockMovementReason } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProductStock, recordStockMovement, InsufficientStockError } from "@/lib/stock";
import { recordAudit } from "@/lib/audit";
import { parseProductsCsv, commitProductsImport, type ImportRowResult } from "@/lib/csv";

export type FormState = { error: string | null };

const MANUAL_REASONS = [
  StockMovementReason.PURCHASE_RECEIVED,
  StockMovementReason.MANUAL_ADJUSTMENT,
  StockMovementReason.DAMAGE,
  StockMovementReason.RETURN,
] as const;

const productSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(64),
  name: z.string().trim().min(1, "Name is required").max(200),
  priceNaira: z.coerce.number().positive("Price must be greater than zero"),
  costNaira: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  moq: z.coerce.number().int().positive().default(1),
  unit: z.string().trim().min(1).max(40).default("piece"),
  active: z.coerce.boolean().default(true),
});

const attributesSchema = z.record(z.string().min(1).max(60), z.string().min(1).max(120));

function parseAttributesJson(raw: FormDataEntryValue | null): Record<string, string> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw);
    const result = attributesSchema.safeParse(parsed);
    if (!result.success || Object.keys(result.data).length === 0) return null;
    return result.data;
  } catch {
    return null;
  }
}

const priceTierSchema = z.array(
  z.object({
    minQuantity: z.number().int().positive(),
    priceNaira: z.number().positive(),
  })
);

function parsePriceTiersJson(raw: FormDataEntryValue | null): { minQuantity: number; priceCents: number }[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = priceTierSchema.parse(JSON.parse(raw));
    return parsed.map((t) => ({ minQuantity: t.minQuantity, priceCents: Math.round(t.priceNaira * 100) }));
  } catch {
    return [];
  }
}

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}

export async function createProductAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();

  const parsed = productSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    priceNaira: formData.get("priceNaira"),
    costNaira: formData.get("costNaira") || undefined,
    moq: formData.get("moq") || undefined,
    unit: formData.get("unit") || undefined,
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid product details." };
  }

  const openingStockRaw = formData.get("openingStock");
  const openingStock =
    typeof openingStockRaw === "string" && openingStockRaw.trim() !== ""
      ? Number(openingStockRaw)
      : 0;
  if (!Number.isInteger(openingStock) || openingStock < 0) {
    return { error: "Opening stock must be a whole number of zero or more." };
  }

  const { sku, name, priceNaira, costNaira, moq, unit, active } = parsed.data;
  const variantAttributes = parseAttributesJson(formData.get("attributesJson"));
  const priceTiers = parsePriceTiersJson(formData.get("priceTiersJson"));
  const priceCents = Math.round(priceNaira * 100);
  const costCents = costNaira === "" || costNaira === undefined ? null : Math.round(costNaira * 100);

  let productId: string;
  try {
    const product = await prisma.product.create({
      data: {
        organizationId: session.user.organizationId,
        sku,
        name,
        variantAttributes: variantAttributes ?? undefined,
        priceCents,
        costCents,
        moq,
        unit,
        active,
        priceTiers: priceTiers.length > 0 ? { create: priceTiers } : undefined,
      },
    });
    productId = product.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: `SKU "${sku}" is already in use.` };
    }
    throw err;
  }

  await recordAudit({
    organizationId: session.user.organizationId,
    entity: "Product",
    entityId: productId,
    action: "PRODUCT_CREATED",
    actorId: session.user.id,
    after: { sku, name, priceCents, active, openingStock },
  });

  if (openingStock > 0) {
    await recordStockMovement({
      organizationId: session.user.organizationId,
      productId,
      quantityDelta: openingStock,
      reason: StockMovementReason.INITIAL_STOCK,
      reference: "OPENING-BALANCE",
      createdById: session.user.id,
    });
  }

  revalidatePath("/catalogue");
  redirect(`/catalogue/${productId}`);
}

export async function updateProductAction(
  productId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();

  const parsed = productSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    priceNaira: formData.get("priceNaira"),
    costNaira: formData.get("costNaira") || undefined,
    moq: formData.get("moq") || undefined,
    unit: formData.get("unit") || undefined,
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid product details." };
  }
  const { sku, name, priceNaira, costNaira, moq, unit, active } = parsed.data;
  const variantAttributes = parseAttributesJson(formData.get("attributesJson"));
  const priceTiers = parsePriceTiersJson(formData.get("priceTiersJson"));
  const priceCents = Math.round(priceNaira * 100);
  const costCents = costNaira === "" || costNaira === undefined ? null : Math.round(costNaira * 100);

  const existing = await prisma.product.findFirst({
    where: { id: productId, organizationId: session.user.organizationId },
  });
  if (!existing) {
    return { error: "Product not found." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          sku,
          name,
          variantAttributes: variantAttributes ?? Prisma.JsonNull,
          priceCents,
          costCents,
          moq,
          unit,
          active,
        },
      });
      await tx.priceTier.deleteMany({ where: { productId } });
      if (priceTiers.length > 0) {
        await tx.priceTier.createMany({
          data: priceTiers.map((t) => ({ productId, ...t })),
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: `SKU "${sku}" is already in use.` };
    }
    throw err;
  }

  await recordAudit({
    organizationId: session.user.organizationId,
    entity: "Product",
    entityId: productId,
    action: "PRODUCT_UPDATED",
    actorId: session.user.id,
    before: { sku: existing.sku, name: existing.name, priceCents: existing.priceCents, active: existing.active },
    after: { sku, name, priceCents, active },
  });

  revalidatePath("/catalogue");
  revalidatePath(`/catalogue/${productId}`);
  return { error: null };
}

const movementSchema = z.object({
  reason: z.enum([
    StockMovementReason.PURCHASE_RECEIVED,
    StockMovementReason.MANUAL_ADJUSTMENT,
    StockMovementReason.DAMAGE,
    StockMovementReason.RETURN,
  ]),
  quantity: z.coerce.number().int("Quantity must be a whole number"),
  note: z.string().trim().max(500).optional(),
});

export async function recordStockMovementAction(
  productId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();

  const direction = formData.get("direction");
  const parsed = movementSchema.safeParse({
    reason: formData.get("reason"),
    quantity: formData.get("quantity"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid movement." };
  }
  if (parsed.data.quantity <= 0) {
    return { error: "Quantity must be greater than zero." };
  }
  if (!MANUAL_REASONS.includes(parsed.data.reason)) {
    return { error: "Not a valid manual movement reason." };
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, organizationId: session.user.organizationId },
  });
  if (!product) {
    return { error: "Product not found." };
  }

  const signedQuantity = direction === "out" ? -parsed.data.quantity : parsed.data.quantity;

  try {
    await recordStockMovement({
      organizationId: session.user.organizationId,
      productId,
      quantityDelta: signedQuantity,
      reason: parsed.data.reason,
      note: parsed.data.note,
      createdById: session.user.id,
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath(`/catalogue/${productId}`);
  revalidatePath("/catalogue");
  return { error: null };
}

export async function getCurrentStock(productId: string) {
  return getProductStock(productId);
}

export type ImportPreviewState = {
  error: string | null;
  rows?: ImportRowResult[];
  csvText?: string;
};

export async function previewImportAction(
  _prevState: ImportPreviewState,
  formData: FormData
): Promise<ImportPreviewState> {
  const session = await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file." };
  }
  const csvText = await file.text();

  const { rows, fileError } = await parseProductsCsv(session.user.organizationId, csvText);
  if (fileError) return { error: fileError };

  return { error: null, rows, csvText };
}

export type ImportCommitState = { error: string | null; created?: number; updated?: number };

export async function commitImportAction(
  _prevState: ImportCommitState,
  formData: FormData
): Promise<ImportCommitState> {
  const session = await requireSession();

  const csvText = formData.get("csvText");
  if (typeof csvText !== "string" || csvText.trim() === "") {
    return { error: "Missing CSV data — go back and choose the file again." };
  }

  // Re-parse against current catalogue state rather than trusting the
  // preview the client already saw — a SKU could have changed since preview.
  const { rows, fileError } = await parseProductsCsv(session.user.organizationId, csvText);
  if (fileError) return { error: fileError };

  const result = await commitProductsImport({
    organizationId: session.user.organizationId,
    actorId: session.user.id,
    rows,
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entity: "Product",
    entityId: "bulk-import",
    action: "CATALOGUE_IMPORTED",
    actorId: session.user.id,
    after: { created: result.created, updated: result.updated },
  });

  revalidatePath("/catalogue");
  return { error: null, created: result.created, updated: result.updated };
}
