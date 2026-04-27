"use strict";

/**
 * ============================================================
 * PARANORMAL VIDEO BUILDER — Telegram Bot thin client
 * ============================================================
 * Этот файл является тонким клиентом, который передаёт запрос
 * в ytPosting service через POST /paranormal/build.
 *
 * Вся логика pipeline живёт в ytPosting:
 *   ytPosting/src/services/paranormalVideoBuilder.service.js
 *   ytPosting/src/channels/voidwhispererx/voidwhispererx.channel.js
 *
 * ytPosting самостоятельно:
 *   - Выполняет весь pipeline (перевод → сцены → изображения → TTS → видео → загрузка)
 *   - Отправляет live-обновления прогресса прямо в Telegram сообщение
 *   - Отправляет финальный результат в Telegram чат
 * ============================================================
 */

const axios = require("axios");

const YTPOSTING_URL     = process.env.YTPOSTING_URL     || "http://localhost:3050";
const YTPOSTING_SECRET  = process.env.YTPOSTING_SECRET  || "";

/**
 * Submits a paranormal video build job to ytPosting.
 * ytPosting will update Telegram messages directly as the pipeline progresses.
 *
 * @param {object} options
 * @param {string}   options.russianText  — история на русском языке
 * @param {string}   options.botToken     — Telegram Bot token (для callback из ytPosting)
 * @param {number}   options.chatId       — Telegram chat ID
 * @param {number}   options.messageId    — ID статусного сообщения для обновления
 * @returns {Promise<{ status: string, message: string }>}
 */
async function submitParanormalJob({ russianText, botToken, chatId, messageId }) {
  const res = await axios.post(
    `${YTPOSTING_URL}/paranormal/build`,
    {
      russianText,
      telegram: { botToken, chatId, messageId },
    },
    {
      headers: {
        "Content-Type":    "application/json",
        "X-Trigger-Secret": YTPOSTING_SECRET,
      },
      timeout: 15000,
    }
  );

  return res.data;
}

/**
 * Sends a cancellation request to ytPosting for the given chat.
 * ytPosting will stop the pipeline before the next step.
 *
 * @param {object} options
 * @param {number} options.chatId — Telegram chat ID (used as job key)
 * @returns {Promise<{ status: string }>}
 */
async function cancelParanormalJob({ chatId }) {
  const res = await axios.post(
    `${YTPOSTING_URL}/paranormal/cancel`,
    { chatId },
    {
      headers: {
        "Content-Type":    "application/json",
        "X-Trigger-Secret": YTPOSTING_SECRET,
      },
      timeout: 8000,
    }
  );
  return res.data;
}

module.exports = { submitParanormalJob, cancelParanormalJob };
