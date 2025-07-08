const db = require("./db");

/**
 * 期限切れトークンを削除
 */
module.exports = async function cleanExpiredTokens() {
  await db.query(`
    DELETE FROM email_change
    WHERE expires_at < NOW()
  `);
  console.log("[cleanup] expired tokens purged"); // Logs に出る
};
