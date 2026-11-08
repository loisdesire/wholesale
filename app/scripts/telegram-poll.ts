import dotenv from "dotenv";
dotenv.config({ override: true });

import { parseTelegramUpdate, fetchTelegramFileBytes } from "../src/lib/telegram";
import { resolveOrganizationForTelegram } from "../src/lib/telegram-routing";
import { ingestInboundMessage, dispatchAIAssistReply } from "../src/lib/inbox";
import { isAIConfigured } from "../src/lib/ai/engine";
import { transcribeAudio } from "../src/lib/ai/transcribe";
import { ConversationChannel } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

/**
 * Local Telegram Long-Polling Script
 * Allows live mobile testing of Adaeze conversational orders without ngrok/webhooks.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN="your-bot-token" npx tsx scripts/telegram-poll.ts
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("❌ Error: TELEGRAM_BOT_TOKEN is not set in environment or .env");
    console.error("Create a bot with @BotFather on Telegram, get your token, and add it to app/.env:");
    console.error('TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"');
    process.exit(1);
  }

  let org = await resolveOrganizationForTelegram(token);
  if (!org) {
    const primary = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (primary) {
      org = await prisma.organization.update({
        where: { id: primary.id },
        data: { telegramBotToken: token },
      });
      console.log(`🔗 Linked Telegram bot token to organization "${org.name}" in database.`);
    } else {
      console.error("❌ Error: No organization found in the database. Run `npm run db:seed` first.");
      process.exit(1);
    }
  }

  console.log(`\n🚀 Telegram Poller Active for Organization: "${org.name}" (${org.id})`);
  console.log("Send a message or voice note to your Telegram Bot from your phone now!\n");

  let offset = 0;

  // Clear existing webhook if any was set
  await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => {});

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=15`
      );
      if (!res.ok) {
        console.warn(`Telegram API error (${res.status}), retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const json = (await res.json()) as {
        ok: boolean;
        result?: Array<{ update_id: number; [key: string]: unknown }>;
      };

      if (json.ok && Array.isArray(json.result)) {
        for (const update of json.result) {
          offset = update.update_id + 1;
          const message = parseTelegramUpdate(update);
          if (!message) continue;

          console.log(`\n📥 Inbound from ${message.contactName} (${message.from}):`);
          console.log(`   "${message.body}"`);

          let attachment: { data: Buffer; mimeType: string } | undefined;
          if (message.media) {
            console.log(`   📎 Downloading media (${message.media.mimeType})...`);
            try {
              attachment = await fetchTelegramFileBytes(message.media.fileId, token);
              console.log(`   ✓ Downloaded ${attachment.data.byteLength} bytes.`);
              if (message.media.mimeType.startsWith("audio/") || message.body.startsWith("[voice note")) {
                console.log("   🎙️ Transcribing voice note via Whisper...");
                const transcript = await transcribeAudio(attachment.data, "voice.ogg", message.media.mimeType);
                if (transcript) {
                  console.log(`   📝 Transcript: "${transcript}"`);
                  message.body = transcript;
                }
              }
            } catch (err) {
              console.warn(`   ⚠️ Media download failed: ${err}`);
            }
          }

          const created = await ingestInboundMessage(
            org.id,
            {
              ...message,
              channel: ConversationChannel.TELEGRAM,
            },
            attachment
          );

          if (created) {
            console.log(`   ✅ Ingested to Adaeze Inbox (Message ID: ${created.id})`);

            if (isAIConfigured()) {
              console.log(`   🤖 Processing with Adaeze AI Copilot...`);
              try {
                const ai = await dispatchAIAssistReply({
                  organizationId: org.id,
                  conversationId: created.conversationId,
                });
                if (ai) {
                  console.log(`   💬 AI Replied: "${ai.replyText}"`);
                  if (ai.draftOrderReference) {
                    console.log(`   📦 Created Draft Order: ${ai.draftOrderReference}`);
                  }
                }
              } catch (aiErr) {
                console.warn(`   ⚠️ AI auto-reply error:`, aiErr);
              }
            } else {
              console.log("   ℹ️ OPENAI_API_KEY not configured — reply via web inbox at http://localhost:3100/inbox");
            }
          } else {
            console.log("   ℹ️ Duplicate message ignored.");
          }
        }
      }
    } catch (err) {
      console.error("Polling network error:", err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch(console.error);
