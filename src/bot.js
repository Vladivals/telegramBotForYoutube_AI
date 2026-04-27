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
// mode: "recipe" | "paranormal"
const userStates   = new Map();
// Set of userIds currently running the paranormal pipeline
const busyUsers    = new Set();

function getMode(userId) {
  return (userStates.get(userId) || {}).mode || "recipe";
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
  const name   = ctx.from?.first_name || "there";
  const userId = ctx.from?.id;
  userStates.set(userId, { mode: "recipe" });

  const hasRecipe    = canUseRecipeVoice(userId);
  const hasParanormal = canUseParanormalChannel(userId);

  await ctx.reply(
    `👋 Привет, ${name}!\n\n` +
    `🤖 *YouTube AI Bot*\n\n` +
    `Выбери режим работы с помощью кнопок ниже:\n\n` +
    `${hasRecipe    ? "✅" : "🔒"} *${BTN_RECIPE}* — генерация профессиональной озвучки для кулинарных видео\n` +
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
    `  2. Разобьёт на сцены с тайминогм\n` +
    `  3. Сгенерирует изображения (Gemini)\n` +
    `  4. Создаст озвучку (Gemini TTS, Charon)\n` +
    `  5. Смонтирует видео (Ken Burns + субтитры)\n` +
    `  6. Сгенерирует название / описание / теги\n` +
    `  7. Создаст обложку YouTube\n` +
    `  8. Загрузит видео на @VoidWhispererX\n\n` +
    `⏱ Время обработки: зависит от длины истории\n\n` +
    `📌 Команды:\n` +
    `/start — главное меню\n` +
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

// ─── Text handler ─────────────────────────────────────────────────────────────
bot.on("text", async (ctx) => {
  const text   = ctx.message.text;
  const userId = ctx.from?.id;

  // Skip commands
  if (text.startsWith("/")) return;
  // Skip button labels (handled by bot.hears)
  if (text === BTN_RECIPE || text === BTN_PARANORMAL || text === BTN_CANCEL) return;

  const mode = getMode(userId);

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

  const statusMsg = await ctx.reply(
    "🎙️ Генерирую озвучку...\n⏳ Подожди, это займёт 10–30 секунд."
  );

  let tmpFilePath = null;

  try {
    logInfo(`[recipe] Generating voiceover for user ${userId} (@${ctx.from?.username}), ${text.length} chars`);

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
      .editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `❌ Не удалось сгенерировать озвучку.\n\nОшибка: ${error.message}\n\nПопробуй ещё раз.`
      )
      .catch(() => {});
  } finally {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      fs.unlinkSync(tmpFilePath);
    }
  }
}

// ─── Handler: Paranormal Video Pipeline ──────────────────────────────────────
async function handleParanormalText(ctx, text, userId) {
  if (!canUseParanormalChannel(userId)) {
    await ctx.reply("🔒 У вас нет доступа к каналу @VoidWhispererX.");
    return;
  }

  if (text.length < 50) {
    await ctx.reply("⚠️ История слишком короткая (минимум 50 символов). Добавь больше деталей.");
    return;
  }

  if (busyUsers.has(userId)) {
    await ctx.reply(
      "⏳ Твоё видео уже в процессе создания.\n" +
      "Подожди завершения текущей задачи."
    );
    return;
  }

  // Send initial status message — ytPosting will update it directly during pipeline
  const statusMsg = await ctx.reply(
    "🚀 *Запускаем pipeline для @VoidWhispererX...*\n\n" +
    "🔄 Передаём задачу в ytPosting...",
    { parse_mode: "Markdown" }
  );

  busyUsers.add(userId);

  try {
    logInfo(`[paranormal] Submitting job to ytPosting for user ${userId} (@${ctx.from?.username}), text: ${text.length} chars`);

    // Submit the job to ytPosting — it runs in background and sends Telegram updates itself
    await submitParanormalJob({
      russianText: text,
      botToken:    BOT_TOKEN,
      chatId:      ctx.chat.id,
      messageId:   statusMsg.message_id,
    });

    // Job accepted — ytPosting will take it from here
    logInfo(`[paranormal] ✅ Job accepted by ytPosting for user ${userId}`);
  } catch (error) {
    logError(`[paranormal] Failed to submit job for user ${userId}: ${error.message}`);
    busyUsers.delete(userId);

    const isUnavailable = error?.response?.status >= 500 || error.code === "ECONNREFUSED" || error.code === "ECONNRESET";
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        isUnavailable
          ? `❌ *ytPosting сервис недоступен*\n\nПопробуй позже или свяжись с администратором.\n\`${error.message}\``
          : `❌ *Ошибка при запуске pipeline*\n\n${error.message}\n\nПопробуй ещё раз.`,
        { parse_mode: "Markdown" }
      )
      .catch(() => {});
    return;
  }

  // ytPosting notifies Telegram when done — bot just needs to release the busy lock
  // We use a generous timeout as a safety release (pipeline can take 10-30+ min)
  const PIPELINE_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes
  setTimeout(() => {
    if (busyUsers.has(userId)) {
      busyUsers.delete(userId);
      logInfo(`[paranormal] Released busy lock for user ${userId} (timeout)`);
    }
  }, PIPELINE_TIMEOUT_MS);
}

// ─── Button: Cancel ──────────────────────────────────────────────────────────
bot.hears(BTN_CANCEL, async (ctx) => {
  const userId = ctx.from?.id;

  if (!busyUsers.has(userId)) {
    await ctx.reply(
      "ℹ️ Нет активных задач для отмены.",
      MAIN_KEYBOARD
    );
    return;
  }

  busyUsers.delete(userId);

  // Try to cancel the job in ytPosting
  try {
    await cancelParanormalJob({ chatId: ctx.chat.id });
  } catch { /* ytPosting might not know about it yet */ }

  await ctx.reply(
    "🚫 *Задача отменена*\n\nПипелайн будет остановлен перед следующим шагом.\n\nМожешь отправить новую историю.",
    { parse_mode: "Markdown", ...MAIN_KEYBOARD }
  );
});

// ─── /cancel command ─────────────────────────────────────────────────────────
bot.command("cancel", async (ctx) => {
  const userId = ctx.from?.id;

  if (!busyUsers.has(userId)) {
    await ctx.reply("ℹ️ Нет активных задач для отмены.", MAIN_KEYBOARD);
    return;
  }

  busyUsers.delete(userId);
  try { await cancelParanormalJob({ chatId: ctx.chat.id }); } catch { /* ignore */ }

  await ctx.reply(
    "🚫 *Задача отменена.* Можешь отправить новую историю.",
    { parse_mode: "Markdown", ...MAIN_KEYBOARD }
  );
});

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  logError(`Bot error for update ${ctx.updateType}: ${err.message}`);
});

// ─── Paranormal reminders for Igor ────────────────────────────────────────────
// Пн/Ср/Пт в 10:00 по GMT+3 = 07:00 UTC → cron: "0 7 * * 1,3,5"
// Igor's Telegram ID: 875313073
const IGOR_CHAT_ID = 875313073;

const REMINDER_MESSAGES = [
  "👻 *Напоминание — @VoidWhispererX*\n\nСегодня нужно опубликовать видео! 🕙 *10:00 GMT+3*\n\nОткрой бота, выбери 👻 *Паранормальный канал* и отправь историю — видео сгенерируется и загрузится автоматически 🚀",
  "🎬 *Время публиковать! — @VoidWhispererX*\n\nНе забудь про видео сегодня! 🕙 *10:00 GMT+3*\n\nОтправь паранормальную историю на русском в бот → система сама переведёт, озвучит и загрузит на YouTube ✅",
  "⏰ *Пора снимать! — @VoidWhispererX*\n\nСегодня день публикации! 🕙 *10:00 GMT+3*\n\nВыбери 👻 *Паранормальный канал* и пришли текст истории — остальное бот сделает сам 🤖",
];

let reminderIndex = 0;

function scheduleIgorReminders(telegramBot) {
  // Пн/Ср/Пт в 07:00 UTC (= 10:00 GMT+3)
  const cronExpr = process.env.IGOR_REMINDER_CRON || "0 7 * * 1,3,5";

  if (!cron.validate(cronExpr)) {
    logError(`[reminder] Invalid cron expression: ${cronExpr}`);
    return;
  }

  cron.schedule(
    cronExpr,
    async () => {
      const msg = REMINDER_MESSAGES[reminderIndex % REMINDER_MESSAGES.length];
      reminderIndex++;

      logInfo(`[reminder] Sending VoidWhispererX reminder to Igor (${IGOR_CHAT_ID})...`);
      try {
        await telegramBot.telegram.sendMessage(IGOR_CHAT_ID, msg, {
          parse_mode: "Markdown",
          ...MAIN_KEYBOARD,
        });
        logInfo("[reminder] ✅ Reminder sent to Igor");
      } catch (err) {
        logError(`[reminder] Failed to send reminder: ${err.message}`);
      }
    },
    { timezone: "UTC" }
  );

  logInfo(`[reminder] ✅ Igor reminder scheduled: ${cronExpr} UTC (= 10:00 GMT+3 Mon/Wed/Fri)`);
}

// ─── Launch ───────────────────────────────────────────────────────────────────
async function main() {
  logInfo("Starting YouTube AI Bot (Recipe Voice + Paranormal Channel)...");
  logInfo(`Allowed users: ${process.env.ALLOWED_TELEGRAM_IDS || "none configured"}`);

  await bot.launch();
  logInfo("Bot is running! 🚀");
  logInfo(`Buttons: "${BTN_RECIPE}" | "${BTN_PARANORMAL}"`);

  // Schedule weekly reminders for Igor about @VoidWhispererX posting
  scheduleIgorReminders(bot);

  process.once("SIGINT",  () => { logInfo("SIGINT — shutting down..."); bot.stop("SIGINT");  });
  process.once("SIGTERM", () => { logInfo("SIGTERM — shutting down..."); bot.stop("SIGTERM"); });
}

main().catch((err) => {
  logError(`Failed to start bot: ${err.message}`);
  process.exit(1);
});
