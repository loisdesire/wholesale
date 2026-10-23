"use client";

import { updateProductAction } from "../actions";
import { ProductForm } from "../product-form";

export function EditProductForm({
  productId,
  defaultValues,
}: {
  productId: string;
  defaultValues: {
    sku: string;
    name: string;
    attributes?: Record<string, string>;
    priceNaira: number;
    costNaira?: number;
    moq: number;
    unit: string;
    active: boolean;
    priceTiers: { minQuantity: number; priceNaira: number }[];
  };
}) {
  return (
    <ProductForm
      action={updateProductAction.bind(null, productId)}
      submitLabel="Save changes"
      defaultValues={defaultValues}
    />
  );
}
