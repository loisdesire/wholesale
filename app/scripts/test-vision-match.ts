import dotenv from "dotenv";
dotenv.config({ override: true });

import fs from "fs";
import path from "path";
import { PrismaClient, ConversationChannel, ConversationStatus } from "@prisma/client";
import { runAIAssist } from "../src/lib/ai/engine";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function testVisionMatch() {
  console.log("🔍 Testing Multimodal AI Image Recognition with gpt-6-luna...");

  const org = await prisma.organization.findFirst({
    where: { name: { contains: "Adaeze" } },
  });
  if (!org) {
    console.error("Organization not found.");
    process.exit(1);
  }

  const owner = await prisma.user.findFirst({
    where: { email: "flomglobal@gmail.com" },
  });

  // Pick or create test customer
  let customer = await prisma.customer.findFirst({
    where: { organizationId: org.id, phone: "+2348039998877" },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        phone: "+2348039998877",
        phoneKey: "+2348039998877",
        name: "Test Vision Buyer",
      },
    });
  }

  // Create test conversation
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      channel: ConversationChannel.TELEGRAM,
      status: ConversationStatus.NEW,
    },
  });

  // Load the test image: tan tote bag
  const imagePath = path.join(__dirname, "../public/test-images/sage-satin-cami.jpg");
  const imageBytes = fs.readFileSync(imagePath);

  // Inbound message with image attachment
  const msg = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      sender: "CUSTOMER",
      body: "Hello! Do you have this in stock? How much is it?",
      attachments: {
        create: {
          mimeType: "image/jpeg",
          data: imageBytes,
          sizeBytes: imageBytes.length,
        },
      },
    },
  });

  console.log(`Created test message ID: ${msg.id} with ${imageBytes.length} bytes photo attachment.`);
  console.log("Calling runAIAssist with gpt-6-luna...");

  const startTime = Date.now();
  const result = await runAIAssist({
    organizationId: org.id,
    conversationId: conversation.id,
    customerId: customer.id,
    createdById: owner?.id ?? "test-owner",
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n⏱️ Completed in ${elapsed}s`);
  console.log("Tool Calls executed:", JSON.stringify(result.toolCalls, null, 2));
  console.log("\n💬 AI Reply:");
  console.log(result.replyText);

  // Clean up test conversation so we don't clutter DB
  await prisma.messageAttachment.deleteMany({ where: { message: { conversationId: conversation.id } } });
  await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.conversation.delete({ where: { id: conversation.id } });
  // kept customer

  console.log("\n🧹 Test conversation cleaned up.");
  process.exit(0);
}

testVisionMatch().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
