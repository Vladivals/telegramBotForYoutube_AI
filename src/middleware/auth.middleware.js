const { logInfo } = require("../utils/logger");

/**
 * Allowed Telegram user IDs
 * Add user IDs as comma-separated values in ALLOWED_TELEGRAM_IDS env variable
 * Example: ALLOWED_TELEGRAM_IDS=123456789,987654321,111222333
 */
function getAllowedUsers() {
  const raw = process.env.ALLOWED_TELEGRAM_IDS || "";
  if (!raw.trim()) return new Set();

  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id))
  );
}

/**
 * Check if a user is allowed to use the bot
 * @param {number|string} userId - Telegram user ID
 * @returns {boolean}
 */
function isUserAllowed(userId) {
  if (!userId) return false;

  const allowedUsers = getAllowedUsers();

  // If no users configured, deny all (security by default)
  if (allowedUsers.size === 0) {
    logInfo(`No allowed users configured — denying user ${userId}`);
    return false;
  }

  return allowedUsers.has(Number(userId));
}

module.exports = { isUserAllowed, getAllowedUsers };
