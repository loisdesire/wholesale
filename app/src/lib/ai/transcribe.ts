import OpenAI from "openai";
import { isAIConfigured } from "./engine";

/**
 * Transcribes voice notes and audio clips (e.g. Telegram / WhatsApp .ogg, .mp3, .m4a)
 * via OpenAI Whisper. Degrades gracefully if unconfigured or on network failure.
 */
export async function transcribeAudio(
  audioBytes: Buffer,
  filename = "voice.ogg",
  mimeType = "audio/ogg"
): Promise<string | null> {
  if (!isAIConfigured()) return null;
  try {
    const client = new OpenAI();
    const file = await OpenAI.toFile(audioBytes, filename, { type: mimeType });
    const res = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    const text = res.text?.trim();
    return text || null;
  } catch (err) {
    console.warn("Audio transcription failed:", err);
    return null;
  }
}
