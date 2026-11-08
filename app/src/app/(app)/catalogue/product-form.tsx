"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";
import { Plus, Trash2, Loader2 } from "lucide-react";

type AttributeRow = { key: string; value: string };
type PriceTierRow = { minQuantity: string; priceNaira: string };

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  defaultValues?: {
    sku?: string;
    name?: string;
    attributes?: Record<string, string>;
    priceNaira?: number;
    costNaira?: number;
    moq?: number;
    unit?: string;
    active?: boolean;
    priceTiers?: { minQuantity: number; priceNaira: number }[];
  };
  showOpeningStock?: boolean;
  showImageUpload?: boolean;
};

export function ProductForm({ action, submitLabel, defaultValues, showOpeningStock, showImageUpload }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {
    error: null,
  });

  const initialAttributes: AttributeRow[] = defaultValues?.attributes
    ? Object.entries(defaultValues.attributes).map(([key, value]) => ({ key, value }))
    : [
        { key: "colour", value: "" },
        { key: "size", value: "" },
      ];
  const [attributes, setAttributes] = useState<AttributeRow[]>(initialAttributes);

  const [tiers, setTiers] = useState<PriceTierRow[]>(
    (defaultValues?.priceTiers ?? []).map((t) => ({
      minQuantity: String(t.minQuantity),
      priceNaira: String(t.priceNaira),
    }))
  );

  const attributesJson = JSON.stringify(
    Object.fromEntries(
      attributes.filter((a) => a.key.trim() && a.value.trim()).map((a) => [a.key.trim(), a.value.trim()])
    )
  );
  const priceTiersJson = JSON.stringify(
    tiers
      .filter((t) => t.minQuantity && t.priceNaira)
      .map((t) => ({ minQuantity: Number(t.minQuantity), priceNaira: Number(t.priceNaira) }))
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="attributesJson" value={attributesJson} />
      <input type="hidden" name="priceTiersJson" value={priceTiersJson} />

      {/* 1. Identification */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="SKU Code" name="sku" defaultValue={defaultValues?.sku} required placeholder="e.g. ANK-2PC-BLK-M" />
        <Field label="Product Name" name="name" defaultValue={defaultValues?.name} required placeholder="e.g. Ankara Two-Piece Set" />
      </div>

      {/* 2. Variant Attributes */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-paper/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink">Variant Attributes</span>
            <p className="text-xs text-text-muted mt-0.5">
              Specific dimensions (e.g. Colour, Size, Material, Bundle packaging).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAttributes((prev) => [...prev, { key: "", value: "" }])}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper transition-all"
          >
            <Plus className="h-3 w-3" /> Add Attribute
          </button>
        </div>

        <div className="flex flex-col gap-2 mt-1">
          {attributes.map((attr, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Attribute (e.g. colour)"
                value={attr.key}
                onChange={(e) =>
                  setAttributes((prev) => prev.map((a, j) => (j === i ? { ...a, key: e.target.value } : a)))
                }
                onFocus={(e) => e.target.select()}
                className="w-1/3 rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-xs text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
              />
              <input
                type="text"
                placeholder="Value (e.g. Black)"
                value={attr.value}
                onChange={(e) =>
                  setAttributes((prev) => prev.map((a, j) => (j === i ? { ...a, value: e.target.value } : a)))
                }
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-xs text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
              />
              <button
                type="button"
                onClick={() => setAttributes((prev) => prev.filter((_, j) => j !== i))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded p-1 text-text-muted hover:text-status-attention-fg transition-colors"
                title="Remove attribute"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Base Pricing & Cost */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Wholesale Price (₦)"
          name="priceNaira"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={defaultValues?.priceNaira}
          required
          placeholder="0.00"
        />
        <Field
          label="Estimated Cost (₦, optional)"
          name="costNaira"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={defaultValues?.costNaira}
          placeholder="0.00"
        />
      </div>

      {/* 4. MOQ & Packaging Unit */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="MOQ (Minimum Order Quantity)"
          name="moq"
          type="number"
          step="1"
          min="1"
          defaultValue={defaultValues?.moq ?? 1}
        />
        <Field label="Unit of Measure" name="unit" defaultValue={defaultValues?.unit ?? "piece"} placeholder="e.g. piece, pack, pair, roll" />
      </div>

      {showOpeningStock && (
        <Field
          label="Initial Opening Stock Balance"
          name="openingStock"
          type="number"
          step="1"
          min="0"
          defaultValue={0}
        />
      )}

      {showImageUpload && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="image" className="text-xs font-semibold uppercase tracking-wider text-ink">
            Product Photo (optional)
          </label>
          <input
            id="image"
            name="image"
            type="file"
            accept="image/*"
            className="text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
        </div>
      )}

      {/* 5. Wholesale Price Tiers */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-paper/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink">Volume Price Breaks (Tiers)</span>
            <p className="text-xs text-text-muted mt-0.5">
              Discounted pricing at quantity thresholds (e.g. 10+ units, 24+ units).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTiers((prev) => [...prev, { minQuantity: "", priceNaira: "" }])}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper transition-all"
          >
            <Plus className="h-3 w-3" /> Add Tier
          </button>
        </div>

        <div className="flex flex-col gap-2 mt-1">
          {tiers.length === 0 ? (
            <span className="text-xs text-text-muted italic">No volume breaks configured. Base price applies to all quantities.</span>
          ) : (
            tiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Min qty (e.g. 12)"
                  value={tier.minQuantity}
                  onChange={(e) =>
                    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, minQuantity: e.target.value } : t)))
                  }
                  className="w-1/3 rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-xs font-tabular text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Tier price (₦)"
                  value={tier.priceNaira}
                  onChange={(e) =>
                    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, priceNaira: e.target.value } : t)))
                  }
                  className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-xs font-tabular text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                />
                <button
                  type="button"
                  onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded p-1 text-text-muted hover:text-status-attention-fg transition-colors"
                  title="Remove tier"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 6. Active Toggle */}
      <label className="flex items-center gap-2.5 text-xs font-medium text-ink cursor-pointer select-none">
        <input
          type="checkbox"
          name="active"
          defaultChecked={defaultValues?.active ?? true}
          className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
        />
        <span>Active &amp; Available for Staff Quoting &amp; WhatsApp AI</span>
      </label>

      {state.error && (
        <div className="rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
          {state.error}
        </div>
      )}

      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-2 active:scale-95 disabled:opacity-60 shadow-sm cursor-pointer"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <span>{pending ? "Saving Product…" : submitLabel}</span>
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  step,
  min,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
  step?: string;
  min?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-semibold uppercase tracking-wider text-ink">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        min={min}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
      />
    </div>
  );
}
