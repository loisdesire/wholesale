/**
 * Canonical form of a phone number, used as the customer identity key.
 *
 * The same person shows up as "0803 123 4567" (typed by staff),
 * "+234 803 123 4567" (pasted) and "2348031234567" (what WhatsApp's webhook
 * sends). Comparing raw strings would split them into three customers, each
 * with its own orders, balance and conversations, so identity is the digits
 * after normalizing. Nigerian national formats are expanded to 234…; numbers
 * from elsewhere are kept as their digits. The SQL backfill in the
 * `customer_identity` migration mirrors these rules.
 */
export function phoneKeyOf(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0\d{10}$/.test(digits)) digits = `234${digits.slice(1)}`; // 08031234567
  else if (/^[789]\d{9}$/.test(digits)) digits = `234${digits}`; // 8031234567
  else if (/^2340\d{10}$/.test(digits)) digits = `234${digits.slice(4)}`; // +234 (0)803 123 4567
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** "+2348031234567" — how we store and show a number. */
export function displayPhone(key: string) {
  return `+${key}`;
}

/** Whether two keys plausibly belong to one line formatted differently (same last 9 digits). */
export function phonesLookRelated(a: string, b: string) {
  return a !== b && a.length >= 9 && b.length >= 9 && a.slice(-9) === b.slice(-9);
}
