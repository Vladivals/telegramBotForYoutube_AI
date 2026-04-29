require("dotenv").config();
const { Telegraf } = require("telegraf");
const cron         = require("node-cron");
const { generateVoiceover }        = require("./services/geminiTTS.service");
const { submitParanormalJob,
        cancelParanormalJob }       = require("./services/paranormalVideoBuilder.service");
const { isUserAllowed, canUseRecipeVoice, canUseParanormalChannel } = require("./middleware/auth.middleware");
const { logInfo, logError } = require("./utils/logger");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  logError("TELEGRAM_BOT_TOKEN is not defined!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ─── Button labels ─────────────────────────────────────────────────────────────
const BTN_RECIPE     = "🎙️ Голос для рецептов";
const BTN_PARANORMAL = "👻 Паранормальный канал";
const BTN_CANCEL     = "🚫 Отмена";

// ─── Persistent bottom keyboard ───────────────────────────────────────────────
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: BTN_RECIPE }, { text: BTN_PARANORMAL }],
      [{ text: BTN_CANCEL }],
    ],
    resize_keyboard:    true,
    persistent:         true,
    one_time_keyboard:  false,
  },
};

// ─── Per-user state ────────────────────────────────────────────────────────────
const userStates = new Map(); // mode: "recipe" | "paranormal"
const busyUsers  = new Set(); // userIds with active paranormal pipeline

// ─── Multi-message accumulator ────────────────────────────────────────────────
// Telegram splits long messages into several parts (max ~4096 chars each).
// We buffer them for MESSAGE_ACCUMULATE_MS ms after the last received part,
// then process the full concatenated text.
const MESSAGE_ACCUMULATE_MS = 3500; // wait 3.5s after the last message
const messageBuffers = new Map();   // userId → { parts: string[], timer: NodeJS.Timeout, count: number }

/**
 * Accumulates text parts for a user.
 * Returns the full text once the timer fires (via onComplete callback).
 * If a part arrives while timer is running — resets the timer.
 */
function accumulateText(userId, text, onComplete) {
  if (messageBuffers.has(userId)) {
    const buf = messageBuffers.get(userId);
    clearTimeout(buf.timer);
    buf.parts.push(text);
    buf.count++;
    buf.timer = setTimeout(() => {
      const fullText = messageBuffers.get(userId)?.parts.join("\n\n") || text;
      messageBuffers.delete(userId);
      onComplete(fullText, buf.count);
    }, MESSAGE_ACCUMULATE_MS);
  } else {
    const entry = {
      parts: [text],
      count: 1,
      timer: setTimeout(() => {
        const fullText = messageBuffers.get(userId)?.parts.join("\n\n") || text;
        messageBuffers.delete(userId);
        onComplete(fullText, entry.count);
      }, MESSAGE_ACCUMULATE_MS),
    };
    messageBuffers.set(userId, entry);
  }
}

function getMode(userId) {
  return (userStates.get(userId) || {}).mode || null;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!isUserAllowed(userId)) {
    logInfo(`Blocked unauthorized user: ${userId} (@${ctx.from?.username})`);
    await ctx.reply(
      "⛔ Access denied. You are not authorized to use this bot.\n" +
      "Contact the administrator to get access."
    );
    return;
  }
  return next();
});

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const name    = ctx.from?.first_name || "there";
  const userId  = ctx.from?.id;
  // Do NOT set a default mode — user must explicitly press a button

  const hasRecipe     = canUseRecipeVoice(userId);
  const hasParanormal = canUseParanormalChannel(userId);

  await ctx.reply(
    `👋 Привет, ${name}!\n\n` +
    `🤖 *YouTube AI Bot*\n\n` +
    `Выбери режим работы с помощью кнопок ниже:\n\n` +
    `${hasRecipe     ? "✅" : "🔒"} *${BTN_RECIPE}* — генерация профессиональной озвучки для кулинарных видео\n` +
    `${hasParanormal ? "✅" : "🔒"} *${BTN_PARANORMAL}* — автоматическая генерация видео для канала @VoidWhispererX\n\n` +
    `Используй /help для справки.`,
    { parse_mode: "Markdown", ...MAIN_KEYBOARD }
  );
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.help(async (ctx) => {
  await ctx.reply(
    `📖 *Справка по боту*\n\n` +
    `*🎙️ Голос для рецептов:*\n` +
    `Нажми кнопку → отправь текст рецепта → получи WAV-файл с озвучкой\n` +
    `(американский акцент, стиль YouTube cooking)\n\n` +
    `*👻 Паранормальный канал:*\n` +
    `Нажми кнопку → отправь текст истории на *русском языке*\n` +
    `Система автоматически:\n` +
    `  1. Переведёт на английский (OpenAI)\n` +
    `  2. Разобьёт на сцены с таймингом\n` +
    `  3. Сгенерирует изображения (Gemini)\n` +
    `  4. Создаст озвучку (Gemini TTS, Charon)\n` +
    `  5. Смонтирует видео (Ken Burns + субтитры)\n` +
    `  6. Сгенерирует название / описание / теги\n` +
    `  7. Создаст обложку YouTube\n` +
    `  8. Загрузит видео на @VoidWhispererX\n\n` +
    `⏱ Время обработки: несколько минут\n\n` +
    `📌 Команды:\n` +
    `/start — главное меню\n` +
    `/cancel — отменить текущую задачу\n` +
    `/id — твой Telegram ID`,
    { parse_mode: "Markdown", ...MAIN_KEYBOARD }
  );
});

// ─── /id ──────────────────────────────────────────────────────────────────────
bot.command("id", async (ctx) => {
  await ctx.reply(
    `🆔 Твой Telegram ID: \`${ctx.from?.id}\`\n` +
    `👤 Username: @${ctx.from?.username || "unknown"}`,
    { parse_mode: "Markdown" }
  );
});

// ─── /cancel command ──────────────────────────────────────────────────────────
bot.command("cancel", async (ctx) => {
  const userId = ctx.from?.id;
  busyUsers.delete(userId);
  try { await cancelParanormalJob({ chatId: ctx.chat.id }); } catch { /* ignore */ }
  await ctx.reply("🚫 Задача отменена. Можешь отправить новую историю.", MAIN_KEYBOARD);
});

// ─── Button: Recipe Voice ─────────────────────────────────────────────────────
bot.hears(BTN_RECIPE, async (ctx) => {
  const userId = ctx.from?.id;
  if (!canUseRecipeVoice(userId)) {
    await ctx.reply("🔒 У вас нет доступа к этой функции.");
    return;
  }
  userStates.set(userId, { mode: "recipe" });
  await ctx.reply(
    `🎙️ *Режим: Голос для рецептов*\n\n` +
    `Отправь текст рецепта (на любом языке) и я сгенерирую профессиональную английскую озвучку.\n\n` +
    `📝 Рекомендуемая длина: 100–500 слов`,
    { parse_mode: "Markdown" }
  );
});

// ─── Button: Paranormal Channel ───────────────────────────────────────────────
bot.hears(BTN_PARANORMAL, async (ctx) => {
  const userId = ctx.from?.id;
  if (!canUseParanormalChannel(userId)) {
    await ctx.reply("🔒 У вас нет доступа к каналу @VoidWhispererX.");
    return;
  }
  userStates.set(userId, { mode: "paranormal" });
  await ctx.reply(
    `👻 *Режим: Паранормальный канал (@VoidWhispererX)*\n\n` +
    `Отправь текст паранормальной истории на *русском языке*.\n\n` +
    `Система автоматически:\n` +
    `• Переведёт текст на английский\n` +
    `• Разобьёт на кинематографические сцены\n` +
    `• Сгенерирует изображения (Gemini)\n` +
    `• Создаст атмосферную озвучку (американский акцент)\n` +
    `• Смонтирует видео с Ken Burns эффектом и субтитрами\n` +
    `• Создаст уникальное название, описание и обложку\n` +
    `• Загрузит видео на YouTube\n\n` +
    `⏱ *Процесс занимает несколько минут*\n\n` +
    `✍️ Отправь историю:`,
    { parse_mode: "Markdown" }
  );
});

// ─── Button: Cancel ───────────────────────────────────────────────────────────
// IMPORTANT: registered BEFORE bot.on("text") so Telegraf routing reaches it.
// Telegraf processes middleware in registration order; bot.on("text") would
// swallow this message and return without calling next() if registered first.
bot.hears(BTN_CANCEL, async (ctx) => {
  const userId = ctx.from?.id;

  if (!busyUsers.has(userId)) {
    await ctx.reply(
      "ℹ️ Нет активных задач для отмены.\n\nПайплайн не запущен или уже завершён.",
      MAIN_KEYBOARD
    );
    return;
  }

  busyUsers.delete(userId);
  try { await cancelParanormalJob({ chatId: ctx.chat.id }); } catch { /* ignore */ }

  await ctx.reply(
    "🚫 *Задача отменена*\n\nПайплайн будет остановлен перед следующим шагом.\n\nМожешь отправить новую историю.",
    { parse_mode: "Markdown", ...MAIN_KEYBOARD }
  );
});

// ─── Text handler (after all hears — keyboard buttons already handled above) ──
bot.on("text", async (ctx) => {
  const text   = ctx.message.text;
  const userId = ctx.from?.id;

  // Skip commands and button labels (already handled by hears above)
  if (text.startsWith("/")) return;
  if (text === BTN_RECIPE || text === BTN_PARANORMAL || text === BTN_CANCEL) return;

  const mode = getMode(userId);

  // Require explicit button press before processing any text
  if (!mode) {
    await ctx.reply(
      "👆 *Сначала выбери режим с помощью кнопки:*\n\n" +
      `• *${BTN_RECIPE}* — генерация озвучки\n` +
      `• *${BTN_PARANORMAL}* — создание видео`,
      { parse_mode: "Markdown", ...MAIN_KEYBOARD }
    );
    return;
  }

  if (mode === "paranormal") {
    await handleParanormalText(ctx, text, userId);
  } else {
    await handleRecipeText(ctx, text, userId);
  }
});

// ─── Handler: Recipe TTS ──────────────────────────────────────────────────────
async function handleRecipeText(ctx, text, userId) {
  if (!canUseRecipeVoice(userId)) {
    await ctx.reply("🔒 У вас нет доступа к этой функции.");
    return;
  }
  if (text.length < 10) {
    await ctx.reply("⚠️ Текст слишком короткий (минимум 10 символов).");
    return;
  }
  if (text.length > 5000) {
    await ctx.reply("⚠️ Текст слишком длинный (максимум 5000 символов). Разбей на части.");
    return;
  }

  const statusMsg = await ctx.reply("🎙️ Генерирую озвучку...\n⏳ Подожди, это займёт 10–30 секунд.");
  let tmpFilePath = null;

  try {
    logInfo(`[recipe] Generating voiceover for user ${userId} (@${ctx.from?.username}), ${text.length} chars`);
    logInfo(`[recipe] Full text:\n---\n${text}\n---`);
    const audioBuffer = await generateVoiceover(text);
    tmpFilePath = path.join(os.tmpdir(), `voiceover_${Date.now()}.wav`);
    fs.writeFileSync(tmpFilePath, audioBuffer);

    await ctx.replyWithAudio(
      { source: tmpFilePath },
      {
        title:     "YouTube Voiceover",
        performer: "Gemini 2.5 Pro TTS",
        caption:   `✅ Озвучка готова!\n📝 Длина текста: ${text.length} символов`,
      }
    );
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    logInfo(`[recipe] Voiceover sent to user ${userId}`);
  } catch (error) {
    logError(`[recipe] Failed for user ${userId}: ${error.message}`);
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
        `❌ Не удалось сгенерировать озвучку.\n\nОшибка: ${error.message}\n\nПопробуй ещё раз.`)
      .catch(() => {});
  } finally {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
  }
}

// ─── Handler: Paranormal Video Pipeline ───────────────────────────────────────
async function handleParanormalText(ctx, text, userId) {
  if (!canUseParanormalChannel(userId)) {
    await ctx.reply("🔒 У вас нет доступа к каналу @VoidWhispererX.");
    return;
  }
  if (busyUsers.has(userId)) {
    await ctx.reply("⏳ Твоё видео уже в процессе создания.\nПодожди завершения текущей задачи.");
    return;
  }

  // ── Multi-message accumulator ─────────────────────────────────────────────
  // Show "typing…" indicator on first message to signal we received it.
  const isFirstPart = !messageBuffers.has(userId);
  if (isFirstPart) {
    // First message part received — let user know we're collecting
    await ctx.reply(
      "✍️ *Принял!* Жду пока ты отправишь историю целиком...\n_(если история в нескольких частях — жди, я их собираю)_",
      { parse_mode: "Markdown" }
    ).catch(() => {});
  }

  accumulateText(userId, text, async (fullText, partsCount) => {
    logInfo(`[paranormal] Accumulated ${partsCount} message parts, total: ${fullText.length} chars`);
    await runParanormalPipeline(ctx, fullText, userId, partsCount);
  });
}

/**
 * Actually launches the pipeline after all message parts are collected.
 */
async function runParanormalPipeline(ctx, fullText, userId, partsCount) {
  if (fullText.length < 50) {
    await ctx.reply("⚠️ История слишком короткая (минимум 50 символов). Добавь больше деталей.");
    return;
  }

  // Build the status message text
  const partsInfo = partsCount > 1 ? `\n📦 Частей сообщения: ${partsCount}` : "";
  const statusMsg = await ctx.reply(
    `🚀 *Запускаем pipeline для @VoidWhispererX...*${partsInfo}\n\n🔄 Передаём задачу в ytPosting...`,
    { parse_mode: "Markdown" }
  );

  busyUsers.add(userId);

  try {
    logInfo(`[paranormal] Submitting job for user ${userId} (@${ctx.from?.username}), text: ${fullText.length} chars, parts: ${partsCount}`);
    logInfo(`[paranormal] Full text:\n---\n${fullText}\n---`);
    await submitParanormalJob({
      russianText: fullText,
      botToken:    BOT_TOKEN,
      chatId:      ctx.chat.id,
      messageId:   statusMsg.message_id,
    });
    logInfo(`[paranormal] ✅ Job accepted by ytPosting for user ${userId}`);
  } catch (error) {
    logError(`[paranormal] Failed to submit job for user ${userId}: ${error.message}`);
    busyUsers.delete(userId);
    const isUnavailable = error?.response?.status >= 500 || error.code === "ECONNREFUSED" || error.code === "ECONNRESET";
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
        isUnavailable
          ? `❌ *ytPosting сервис недоступен*\n\nПопробуй позже или свяжись с администратором.\n\`${error.message}\``
          : `❌ *Ошибка при запуске pipeline*\n\n${error.message}\n\nПопробуй ещё раз.`,
        { parse_mode: "Markdown" })
      .catch(() => {});
    return;
  }

  // Release busy lock after 45 min timeout (safety valve)
  setTimeout(() => {
    if (busyUsers.has(userId)) {
      busyUsers.delete(userId);
      logInfo(`[paranormal] Released busy lock for user ${userId} (timeout)`);
    }
  }, 45 * 60 * 1000);
}

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  logError(`Bot error for update ${ctx.updateType}: ${err.message}`);
});

// ─── Paranormal reminders for Igor ────────────────────────────────────────────
const IGOR_CHAT_ID = 875313073;
const REMINDER_MESSAGES = [
  "👻 *Напоминание — @VoidWhispererX*\n\nСегодня нужно опубликовать видео! 🕙 *10:00 GMT+3*\n\nОткрой бота, выбери 👻 *Паранормальный канал* и отправь историю — видео сгенерируется и загрузится автоматически 🚀",
  "🎬 *Время публиковать! — @VoidWhispererX*\n\nНе забудь про видео сегодня! 🕙 *10:00 GMT+3*\n\nОтправь паранормальную историю на русском в бот → система сама переведёт, озвучит и загрузит на YouTube ✅",
  "⏰ *Пора снимать! — @VoidWhispererX*\n\nСегодня день публикации! 🕙 *10:00 GMT+3*\n\nВыбери 👻 *Паранормальный канал* и пришли текст истории — остальное бот сделает сам 🤖",
];
let reminderIndex = 0;

function scheduleIgorReminders(telegramBot) {
  const cronExpr = process.env.IGOR_REMINDER_CRON || "0 7 * * 1,3,5";
  if (!cron.validate(cronExpr)) {
    logError(`[reminder] Invalid cron expression: ${cronExpr}`);
    return;
  }
  cron.schedule(cronExpr, async () => {
    const msg = REMINDER_MESSAGES[reminderIndex % REMINDER_MESSAGES.length];
    reminderIndex++;
    logInfo(`[reminder] Sending VoidWhispererX reminder to Igor (${IGOR_CHAT_ID})...`);
    try {
      await telegramBot.telegram.sendMessage(IGOR_CHAT_ID, msg, { parse_mode: "Markdown", ...MAIN_KEYBOARD });
      logInfo("[reminder] ✅ Reminder sent to Igor");
    } catch (err) {
      logError(`[reminder] Failed to send reminder: ${err.message}`);
    }
  }, { timezone: "UTC" });
  logInfo(`[reminder] ✅ Igor reminder scheduled: ${cronExpr} UTC (= 10:00 GMT+3 Mon/Wed/Fri)`);
}

// ─── Launch ───────────────────────────────────────────────────────────────────
async function main() {
  logInfo("Starting YouTube AI Bot (Recipe Voice + Paranormal Channel)...");
  logInfo(`Allowed users: ${process.env.ALLOWED_TELEGRAM_IDS || "none configured"}`);

  await bot.launch();
  logInfo("Bot is running! 🚀");

  scheduleIgorReminders(bot);

  process.once("SIGINT",  () => { logInfo("SIGINT — shutting down...");  bot.stop("SIGINT");  });
  process.once("SIGTERM", () => { logInfo("SIGTERM — shutting down..."); bot.stop("SIGTERM"); });
}

main().catch((err) => {
  logError(`Failed to start bot: ${err.message}`);
  process.exit(1);
});
