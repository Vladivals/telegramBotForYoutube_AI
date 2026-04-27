const { logInfo } = require("../utils/logger");

/**
 * ────────────────────────────────────────────────────────────────────────────
 * AUTHORIZED USERS
 * ────────────────────────────────────────────────────────────────────────────
 * ALLOWED_TELEGRAM_IDS         — общий доступ к боту
 * RECIPE_VOICE_ALLOWED_IDS     — кнопка «Голос для рецептов» (TTS)
 * VOIDWHISPERERX_ALLOWED_IDS   — кнопка «Паранормальный канал» (video pipeline)
 *
 * Если RECIPE_VOICE_ALLOWED_IDS / VOIDWHISPERERX_ALLOWED_IDS не заданы в .env,
 * используется ALLOWED_TELEGRAM_IDS как запасной список.
 * ────────────────────────────────────────────────────────────────────────────
 */

function parseIds(raw) {
  if (!raw || !raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id))
  );
}

function getAllowedUsers() {
  return parseIds(process.env.ALLOWED_TELEGRAM_IDS || "");
}

function getRecipeVoiceAllowedUsers() {
  const specific = parseIds(process.env.RECIPE_VOICE_ALLOWED_IDS || "");
  return specific.size > 0 ? specific : getAllowedUsers();
}

function getVoidWhispererXAllowedUsers() {
  const specific = parseIds(process.env.VOIDWHISPERERX_ALLOWED_IDS || "");
  return specific.size > 0 ? specific : getAllowedUsers();
}

/**
 * Проверяет общий доступ к боту
 * @param {number|string} userId
 * @returns {boolean}
 */
function isUserAllowed(userId) {
  if (!userId) return false;
  const allowedUsers = getAllowedUsers();
  if (allowedUsers.size === 0) {
    logInfo(`No allowed users configured — denying user ${userId}`);
    return false;
  }
  return allowedUsers.has(Number(userId));
}

/**
 * Проверяет доступ к кнопке «Голос для рецептов»
 * Vlad (187993301) и Igor (875313073) разрешены по умолчанию.
 * @param {number|string} userId
 * @returns {boolean}
 */
function canUseRecipeVoice(userId) {
  if (!userId) return false;
  const allowed = getRecipeVoiceAllowedUsers();
  return allowed.size > 0 && allowed.has(Number(userId));
}

/**
 * Проверяет доступ к кнопке «Паранормальный канал» (@VoidWhispererX pipeline)
 * Vlad (187993301) и Igor (875313073) разрешены по умолчанию.
 * @param {number|string} userId
 * @returns {boolean}
 */
function canUseParanormalChannel(userId) {
  if (!userId) return false;
  const allowed = getVoidWhispererXAllowedUsers();
  return allowed.size > 0 && allowed.has(Number(userId));
}

module.exports = {
  isUserAllowed,
  getAllowedUsers,
  canUseRecipeVoice,
  canUseParanormalChannel,
};
