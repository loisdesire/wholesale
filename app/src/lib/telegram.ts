export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export class TelegramSendError extends Error {}
export class TelegramMediaError extends Error {}

export type InboundTelegramMessage = {
  externalId: string;
  from: string;
  chatId: string;
  contactName?: string;
  timestamp: Date;
  body: string;
  media?: { fileId: string; mimeType: string };
};

/**
 * Normalizes a Telegram Bot API webhook POST body into an inbound message.
 */
export function parseTelegramUpdate(body: unknown): InboundTelegramMessage | null {
  if (!body || typeof body !== "object") return null;
  const update = body as {
    update_id?: number;
    message?: {
      message_id: number;
      from?: { id: number; first_name?: string; last_name?: string; username?: string };
      chat: { id: number; type: string };
      date: number;
      text?: string;
      caption?: string;
      voice?: { file_id: string; mime_type?: string; duration?: number };
      audio?: { file_id: string; mime_type?: string; duration?: number };
      photo?: { file_id: string; file_size?: number }[];
    };
  };

  const msg = update.message;
  if (!msg || !msg.chat) return null;

  const chatId = String(msg.chat.id);
  // Phone/identity: we use tg_<chatId> or customer phone if available
  const from = `tg_${chatId}`;

  const nameParts = [msg.from?.first_name, msg.from?.last_name].filter(Boolean);
  const contactName = nameParts.length > 0 ? nameParts.join(" ") : msg.from?.username || `Telegram User ${chatId}`;

  const timestamp = new Date(msg.date * 1000);
  const externalId = `tg_msg_${msg.message_id}`;

  let bodyText = msg.text || msg.caption || "";
  let media: { fileId: string; mimeType: string } | undefined;

  if (msg.voice) {
    media = { fileId: msg.voice.file_id, mimeType: msg.voice.mime_type || "audio/ogg" };
    if (!bodyText) {
      bodyText = `[voice note: ${msg.voice.duration || 0}s]`;
    }
  } else if (msg.audio) {
    media = { fileId: msg.audio.file_id, mimeType: msg.audio.mime_type || "audio/mpeg" };
    if (!bodyText) {
      bodyText = `[audio: ${msg.audio.duration || 0}s]`;
    }
  } else if (msg.photo && msg.photo.length > 0) {
    // Pick highest resolution photo (last in array)
    const bestPhoto = msg.photo[msg.photo.length - 1];
    media = { fileId: bestPhoto.file_id, mimeType: "image/jpeg" };
    if (!bodyText) {
      bodyText = "[photo]";
    }
  }

  if (!bodyText && !media) return null;

  return {
    externalId,
    from,
    chatId,
    contactName,
    timestamp,
    body: bodyText,
    media,
  };
}

/**
 * Sends an outbound reply text message to a Telegram chat.
 */
export async function sendTelegramTextMessage(
  chatId: string,
  text: string,
  tokenOverride?: string | null
): Promise<{ messageId: string }> {
  const token = tokenOverride || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    // Graceful offline mock mode when token not yet configured
    console.warn("Telegram not configured (missing TELEGRAM_BOT_TOKEN). Mocking send.");
    return { messageId: `mock_tg_${Date.now()}` };
  }

  // Strip tg_ prefix and leading + if passed from customer identity or phone formatter
  const cleanChatId = chatId.replace(/^tg_/, "").replace(/^\+/, "").trim();

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text,
      parse_mode: "HTML",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TelegramSendError(`Telegram send failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
  const messageId = json.result?.message_id ? `tg_msg_${json.result.message_id}` : undefined;
  if (!messageId) {
    throw new TelegramSendError("Telegram send returned no message id.");
  }
  return { messageId };
}

/**
 * Sends an outbound photo (with caption) to a Telegram chat — e.g. the catalogue photo a real
 * visual-search match found, so the customer can see exactly what matched instead of trusting a
 * text claim. Caption text, not a separate message, same as Telegram's own native photo+text UX.
 */
export async function sendTelegramPhoto(
  chatId: string,
  photo: { data: Buffer; mimeType: string },
  caption: string,
  tokenOverride?: string | null
): Promise<{ messageId: string }> {
  const token = tokenOverride || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("Telegram not configured (missing TELEGRAM_BOT_TOKEN). Mocking photo send.");
    return { messageId: `mock_tg_${Date.now()}` };
  }

  const cleanChatId = chatId.replace(/^tg_/, "").replace(/^\+/, "").trim();
  const ext = photo.mimeType === "image/png" ? "png" : "jpg";

  const form = new FormData();
  form.append("chat_id", cleanChatId);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("photo", new Blob([new Uint8Array(photo.data)], { type: photo.mimeType }), `product.${ext}`);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TelegramSendError(`Telegram photo send failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
  const messageId = json.result?.message_id ? `tg_msg_${json.result.message_id}` : undefined;
  if (!messageId) {
    throw new TelegramSendError("Telegram photo send returned no message id.");
  }
  return { messageId };
}

/**
 * Tells Telegram to show the "X is typing…" indicator in the chat. Telegram only holds this for
 * ~5 seconds, so callers waiting on something slower (an AI reply) should re-send it on an
 * interval for the duration of the wait, not just once.
 */
export async function sendTelegramChatAction(
  chatId: string,
  tokenOverride?: string | null
): Promise<void> {
  const token = tokenOverride || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const cleanChatId = chatId.replace(/^tg_/, "").replace(/^\+/, "").trim();
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cleanChatId, action: "typing" }),
  }).catch(() => {});
}

/**
 * Downloads voice or image file bytes from Telegram API.
 */
export async function fetchTelegramFileBytes(
  fileId: string,
  tokenOverride?: string | null
): Promise<{ data: Buffer; mimeType: string }> {
  const token = tokenOverride || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramMediaError("Telegram isn't configured (missing TELEGRAM_BOT_TOKEN).");
  }

  const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  if (!getFileRes.ok) {
    throw new TelegramMediaError(`Could not resolve telegram file ${fileId} (${getFileRes.status})`);
  }

  const fileMeta = (await getFileRes.json()) as { ok?: boolean; result?: { file_path?: string } };
  const filePath = fileMeta.result?.file_path;
  if (!filePath) {
    throw new TelegramMediaError(`Telegram file ${fileId} has no file_path.`);
  }

  const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!downloadRes.ok) {
    throw new TelegramMediaError(`Could not download telegram file from ${filePath} (${downloadRes.status})`);
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  let mimeType = "application/octet-stream";
  if (filePath.endsWith(".ogg") || filePath.endsWith(".oga")) mimeType = "audio/ogg";
  else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) mimeType = "image/jpeg";
  else if (filePath.endsWith(".png")) mimeType = "image/png";

  return { data: Buffer.from(arrayBuffer), mimeType };
}
