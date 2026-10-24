import Papa from "papaparse";
import { z } from "zod";
import { StockMovementReason } from "@prisma/client";
import { tenantDb, transaction } from "@/lib/db";
import { recordStockMovementTx } from "@/lib/stock";

const CSV_COLUMNS = [
  "sku",
  "name",
  "colour",
  "size",
  "other_attributes",
  "price",
  "cost",
  "moq",
  "unit",
  "active",
  "opening_stock",
] as const;

const rowSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(64),
  name: z.string().trim().min(1, "Name is required").max(200),
  colour: z.string().trim().max(60).optional(),
  size: z.string().trim().max(60).optional(),
  other_attributes: z.string().trim().optional(),
  price: z.coerce.number().positive("Price must be greater than zero"),
  cost: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  moq: z.coerce.number().int().positive().optional(),
  unit: z.string().trim().max(40).optional(),
  active: z.string().trim().optional(),
  opening_stock: z.coerce.number().int().min(0).optional(),
});

export type ImportRowResult = {
  rowNumber: number;
  sku: string;
  action: "create" | "update" | "error";
  name?: string;
  priceCents?: number;
  costCents?: number | null;
  moq?: number;
  unit?: string;
  active?: boolean;
  variantAttributes?: Record<string, string> | null;
  openingStock?: number;
  errors: string[];
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return fallback;
}

/**
 * Parses and validates a product CSV against the current catalogue, without
 * writing anything — this is the "preview before committing" step VISION.md
 * asks for. Each row is classified as a create (new SKU), update (existing
 * SKU — only commercial fields change; stock is never touched here, that
 * stays a ledger movement with its own reason), or error.
 */
export async function parseProductsCsv(
  organizationId: string,
  csvText: string
): Promise<{ rows: ImportRowResult[]; fileError: string | null }> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    return { rows: [], fileError: parsed.errors[0].message };
  }
  if (parsed.data.length === 0) {
    return { rows: [], fileError: "The file has no data rows." };
  }

  const existingProducts = await tenantDb(organizationId).product.findMany({
    where: { organizationId },
    select: { sku: true },
  });
  const existingSkus = new Set(existingProducts.map((p) => p.sku));

  const skuCounts = new Map<string, number>();
  for (const raw of parsed.data) {
    const sku = raw.sku?.trim();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  const rows: ImportRowResult[] = parsed.data.map((raw, i) => {
    const rowNumber = i + 2; // +1 for header row, +1 for 1-indexing
    const parsedRow = rowSchema.safeParse(raw);

    if (!parsedRow.success) {
      return {
        rowNumber,
        sku: raw.sku ?? "(missing)",
        action: "error",
        errors: parsedRow.error.issues.map((issue) => issue.message),
      };
    }

    const data = parsedRow.data;
    const errors: string[] = [];

    if ((skuCounts.get(data.sku) ?? 0) > 1) {
      errors.push(`SKU "${data.sku}" appears more than once in this file.`);
    }

    let variantAttributes: Record<string, string> | null = null;
    if (data.colour || data.size) {
      variantAttributes = {};
      if (data.colour) variantAttributes.colour = data.colour;
      if (data.size) variantAttributes.size = data.size;
    }
    if (data.other_attributes) {
      try {
        const extra = JSON.parse(data.other_attributes);
        if (extra && typeof extra === "object" && !Array.isArray(extra)) {
          variantAttributes = { ...(variantAttributes ?? {}), ...extra };
        } else {
          errors.push("other_attributes must be a JSON object, e.g. {\"material\":\"Cotton\"}.");
        }
      } catch {
        errors.push("other_attributes is not valid JSON.");
      }
    }

    const isUpdate = existingSkus.has(data.sku);

    if (errors.length > 0) {
      return { rowNumber, sku: data.sku, action: "error", errors };
    }

    return {
      rowNumber,
      sku: data.sku,
      action: isUpdate ? "update" : "create",
      name: data.name,
      priceCents: Math.round(data.price * 100),
      costCents: data.cost === "" || data.cost === undefined ? null : Math.round(Number(data.cost) * 100),
      moq: data.moq ?? 1,
      unit: data.unit || "piece",
      active: parseBoolean(data.active, true),
      variantAttributes,
      openingStock: isUpdate ? undefined : (data.opening_stock ?? 0),
      errors: [],
    };
  });

  return { rows, fileError: null };
}

/**
 * Writes the previously-validated, error-free rows to the catalogue. Takes
 * the exact rows a preview already classified — never re-derives them from
 * raw CSV text again, so what gets committed is what staff actually saw.
 */
export async function commitProductsImport(params: {
  organizationId: string;
  actorId: string;
  rows: ImportRowResult[];
}): Promise<{ created: number; updated: number }> {
  const toCommit = params.rows.filter((r) => r.action !== "error");
  let created = 0;
  let updated = 0;

  await transaction(params.organizationId, async (tx) => {
    for (const row of toCommit) {
      if (row.action === "create") {
        const product = await tx.product.create({
          data: {
            organizationId: params.organizationId,
            sku: row.sku,
            name: row.name!,
            variantAttributes: row.variantAttributes ?? undefined,
            priceCents: row.priceCents!,
            costCents: row.costCents ?? undefined,
            moq: row.moq ?? 1,
            unit: row.unit ?? "piece",
            active: row.active ?? true,
          },
        });
        if (row.openingStock && row.openingStock > 0) {
          await recordStockMovementTx(tx, {
            organizationId: params.organizationId,
            productId: product.id,
            quantityDelta: row.openingStock,
            reason: StockMovementReason.INITIAL_STOCK,
            reference: "CSV-IMPORT",
            createdById: params.actorId,
          });
        }
        created++;
      } else if (row.action === "update") {
        await tx.product.updateMany({
          where: { organizationId: params.organizationId, sku: row.sku },
          data: {
            name: row.name!,
            variantAttributes: row.variantAttributes ?? undefined,
            priceCents: row.priceCents!,
            costCents: row.costCents ?? undefined,
            moq: row.moq ?? 1,
            unit: row.unit ?? "piece",
            active: row.active ?? true,
          },
        });
        updated++;
      }
    }
  });

  return { created, updated };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * A spreadsheet that opens a CSV may treat a cell starting with = + - @ as a formula —
 * and a customer/product name or note is text anyone could have typed. Prefixing such a
 * cell with a quote makes it inert text, so an export can't run as somebody's formula on
 * the finance person's laptop.
 */
export function csvSafe(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  return Papa.unparse({ fields: headers, data: rows.map((row) => row.map(csvSafe)) });
}

export function serializeProductsCsv(
  products: {
    sku: string;
    name: string;
    variantAttributes: unknown;
    priceCents: number;
    costCents: number | null;
    moq: number;
    unit: string;
    active: boolean;
    stock: number;
  }[]
): string {
  const lines = [CSV_COLUMNS.join(",")];

  for (const p of products) {
    const variant = (p.variantAttributes as Record<string, string> | null) ?? {};
    const { colour, size, ...rest } = variant;
    const otherAttributes = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";

    const row = [
      p.sku,
      p.name,
      colour ?? "",
      size ?? "",
      otherAttributes,
      (p.priceCents / 100).toString(),
      p.costCents !== null ? (p.costCents / 100).toString() : "",
      p.moq.toString(),
      p.unit,
      p.active ? "true" : "false",
      p.stock.toString(),
    ];
    // Formula-safe first (a SKU or name is free text someone else typed), then escape
    // quotes/commas/newlines for the CSV cell itself.
    lines.push(row.map((v) => csvEscape(String(csvSafe(v)))).join(","));
  }

  return lines.join("\n");
}
