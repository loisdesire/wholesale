/**
 * The product's own name — what appears on the landing page, sign-in, logo and browser tabs.
 * Deliberately separate from a business's name (Organization.name), which is the customer
 * using the product. Change it in one place, or set NEXT_PUBLIC_APP_NAME at build time.
 */
export const BRAND_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Dispatch";

export const BRAND_DESCRIPTION =
  "Turn WhatsApp enquiries into tracked wholesale orders — inbox, orders, stock, payments and reports in one place.";
