-- AlterEnum
ALTER TYPE "ConversationChannel" ADD VALUE 'TELEGRAM';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "telegramBotToken" TEXT,
ADD COLUMN "telegramBotUsername" TEXT;
