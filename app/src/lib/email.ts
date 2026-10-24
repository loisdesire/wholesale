/**
 * Email notifications — a second, push channel layered on top of the always-on
 * in-app notifications (`src/lib/notifications.ts`), the same "degrades gracefully
 * without real credentials" shape as WhatsApp (`src/lib/whatsapp.ts`): without
 * configuration the app just doesn't send, never fakes or silently drops an error
 * that should have been visible.
 */
export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export class EmailSendError extends Error {}

/**
 * Sends a plain-text email via the Resend HTTP API. Throws on any failure —
 * callers must not treat a notification as delivered unless this resolves, per the
 * principle that the app never claims an action it hasn't confirmed.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new EmailSendError("Email isn't configured (missing RESEND_API_KEY / EMAIL_FROM).");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new EmailSendError(`Email send failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new EmailSendError("Email send returned no id.");
  }
  return { id: json.id };
}
