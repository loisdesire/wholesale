-- AI-generated description of the product's own photo, so text search can match style
-- language (e.g. "bootcut") that never appears in a product's name/SKU. See
-- src/lib/ai/product-description.ts.
ALTER TABLE "Product" ADD COLUMN     "visualDescription" TEXT;
