function timestamp() {
  return new Date().toISOString();
}

function logInfo(message) {
  console.log(`[${timestamp()}] [INFO] ${message}`);
}

function logError(message) {
  console.error(`[${timestamp()}] [ERROR] ${message}`);
}

function logWarn(message) {
  console.warn(`[${timestamp()}] [WARN] ${message}`);
}

module.exports = { logInfo, logError, logWarn };
