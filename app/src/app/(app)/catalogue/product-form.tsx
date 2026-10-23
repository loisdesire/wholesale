"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";

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
};

export function ProductForm({ action, submitLabel, defaultValues, showOpeningStock }: Props) {
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
    <form action={formAction} className="flex max-w-lg flex-col gap-6">
      <input type="hidden" name="attributesJson" value={attributesJson} />
      <input type="hidden" name="priceTiersJson" value={priceTiersJson} />

      <div className="grid grid-cols-2 gap-4">
        <Field label="SKU" name="sku" defaultValue={defaultValues?.sku} required />
        <Field label="Product name" name="name" defaultValue={defaultValues?.name} required />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Variant attributes</span>
        <p className="text-xs text-text-muted">
          Colour, size, or anything else specific to this business (material, model, packaging…).
        </p>
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
              className="w-1/3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
            <input
              type="text"
              placeholder="Value (e.g. Black)"
              value={attr.value}
              onChange={(e) =>
                setAttributes((prev) => prev.map((a, j) => (j === i ? { ...a, value: e.target.value } : a)))
              }
              onFocus={(e) => e.target.select()}
              className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
            <button
              type="button"
              onClick={() => setAttributes((prev) => prev.filter((_, j) => j !== i))}
              className="text-xs text-status-attention-fg hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setAttributes((prev) => [...prev, { key: "", value: "" }])}
          className="self-start text-xs text-ink underline underline-offset-2"
        >
          Add attribute
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Price (₦)"
          name="priceNaira"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={defaultValues?.priceNaira}
          required
        />
        <Field
          label="Cost (₦, optional)"
          name="costNaira"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={defaultValues?.costNaira}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="MOQ (minimum order qty)"
          name="moq"
          type="number"
          step="1"
          min="1"
          defaultValue={defaultValues?.moq ?? 1}
        />
        <Field label="Unit" name="unit" defaultValue={defaultValues?.unit ?? "piece"} />
      </div>

      {showOpeningStock && (
        <Field
          label="Opening stock"
          name="openingStock"
          type="number"
          step="1"
          min="0"
          defaultValue={0}
        />
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Wholesale price tiers (optional)</span>
        <p className="text-xs text-text-muted">
          Quantity breaks — e.g. 10+ units at a lower price. The base price above always applies
          below the lowest tier.
        </p>
        {tiers.map((tier, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Min qty"
              value={tier.minQuantity}
              onChange={(e) =>
                setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, minQuantity: e.target.value } : t)))
              }
              className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Price (₦) at that qty"
              value={tier.priceNaira}
              onChange={(e) =>
                setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, priceNaira: e.target.value } : t)))
              }
              className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
            <button
              type="button"
              onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}
              className="text-xs text-status-attention-fg hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setTiers((prev) => [...prev, { minQuantity: "", priceNaira: "" }])}
          className="self-start text-xs text-ink underline underline-offset-2"
        >
          Add price tier
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="active"
          defaultChecked={defaultValues?.active ?? true}
          className="h-4 w-4 rounded border-line"
        />
        Active (visible to AI and staff for quoting)
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
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
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
  step?: string;
  min?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        min={min}
        defaultValue={defaultValue}
        required={required}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
      />
    </div>
  );
}
