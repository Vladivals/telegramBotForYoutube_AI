require("dotenv").config();
const { Telegraf } = require("telegraf");
const { generateVoiceover } = require("./services/geminiTTS.service");
const { isUserAllowed } = require("./middleware/auth.middleware");
const { logInfo, logError } = require("./utils/logger");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  logError("TELEGRAM_BOT_TOKEN is not defined!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ─── Auth middleware ───────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!isUserAllowed(userId)) {
    logInfo(`Blocked unauthorized user: ${userId} (@${ctx.from?.username})`);
    await ctx.reply(
      "⛔ Access denied. You are not authorized to use this bot.\nContact the administrator to get access."
    );
    return;
  }
  return next();
});

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const name = ctx.from?.first_name || "there";
  await ctx.reply(
    `👋 Hello, ${name}!\n\n` +
    `🎙️ *YouTube AI Voiceover Bot*\n\n` +
    `Send me a recipe script or any cooking-related text and I'll generate a professional English voiceover audio file ready for your YouTube video.\n\n` +
    `🍳 *Optimized for:*\n` +
    `• American cooking audience\n` +
    `• YouTube food & recipe content\n` +
    `• Natural, engaging narration style\n\n` +
    `Just paste your script and hit send! 🚀`,
    { parse_mode: "Markdown" }
  );
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.help(async (ctx) => {
  await ctx.reply(
    `🎙️ *How to use this bot:*\n\n` +
    `1. Type or paste your cooking recipe script\n` +
    `2. Send it to the bot\n` +
    `3. Wait for the AI to generate the voiceover (~10-30 sec)\n` +
    `4. Download the audio file and use it in your video\n\n` +
    `📝 *Tips for best results:*\n` +
    `• Write naturally, as you'd speak\n` +
    `• Include ingredient names and steps clearly\n` +
    `• Scripts between 100-500 words work best\n\n` +
    `🤖 Powered by Google Gemini 2.5 Pro TTS`,
    { parse_mode: "Markdown" }
  );
});

// ─── /id ──────────────────────────────────────────────────────────────────────
bot.command("id", async (ctx) => {
  await ctx.reply(
    `🆔 Your Telegram ID: \`${ctx.from?.id}\`\n` +
    `👤 Username: @${ctx.from?.username || "unknown"}`,
    { parse_mode: "Markdown" }
  );
});

// ─── Text handler ─────────────────────────────────────────────────────────────
bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  // Skip commands
  if (text.startsWith("/")) return;

  if (text.length < 10) {
    await ctx.reply("⚠️ Please send a longer text (at least 10 characters) to generate a voiceover.");
    return;
  }

  if (text.length > 5000) {
    await ctx.reply("⚠️ Text is too long (max 5000 characters). Please split it into parts.");
    return;
  }

  const statusMsg = await ctx.reply(
    "🎙️ Generating voiceover...\n⏳ Please wait, this may take 10-30 seconds."
  );

  let tmpFilePath = null;

  try {
    logInfo(`Generating voiceover for user ${ctx.from?.id} (@${ctx.from?.username}), text length: ${text.length}`);

    const audioBuffer = await generateVoiceover(text);

    // Save to temp file
    tmpFilePath = path.join(os.tmpdir(), `voiceover_${Date.now()}.wav`);
    fs.writeFileSync(tmpFilePath, audioBuffer);

    logInfo(`Voiceover generated, file size: ${audioBuffer.length} bytes, sending to user ${ctx.from?.id}`);

    // Send audio file
    await ctx.replyWithAudio(
      { source: tmpFilePath },
      {
        title: "YouTube Voiceover",
        performer: "Gemini 2.5 Pro TTS",
        caption: `✅ Voiceover ready!\n📝 Script length: ${text.length} characters`,
      }
    );

    // Delete status message
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    logInfo(`Voiceover sent successfully to user ${ctx.from?.id}`);
  } catch (error) {
    logError(`Failed to generate voiceover for user ${ctx.from?.id}: ${error.message}`);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Failed to generate voiceover.\n\nError: ${error.message}\n\nPlease try again or contact the administrator.`
    ).catch(() => {});
  } finally {
    // Cleanup temp file
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      fs.unlinkSync(tmpFilePath);
    }
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  logError(`Bot error for update ${ctx.updateType}: ${err.message}`);
});

// ─── Launch ───────────────────────────────────────────────────────────────────
async function main() {
  logInfo("Starting YouTube AI Voiceover Bot...");
  logInfo(`Allowed users: ${process.env.ALLOWED_TELEGRAM_IDS || "none configured"}`);

  await bot.launch();
  logInfo("Bot is running! 🚀");

  // Graceful shutdown
  process.once("SIGINT", () => {
    logInfo("SIGINT received, shutting down...");
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    logInfo("SIGTERM received, shutting down...");
    bot.stop("SIGTERM");
  });
}

main().catch((err) => {
  logError(`Failed to start bot: ${err.message}`);
  process.exit(1);
});
