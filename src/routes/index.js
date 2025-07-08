const express = require("express");
const router  = express.Router();

/**
 * デバッグ用: /api/ping → { pong: true }
 * 動作確認が終わったら削除しても OK
 */
router.get("/ping", (_, res) => res.json({ pong: true }));

/**
 * メールアドレス変更認証エンドポイント
 *   GET /api/emailChange/confirm?token=xxxx
 */
router.use("/emailChange", require("./emailChange"));

/**
 * 将来 Billing API を実装するときに有効化
 * 例:
 *   router.use("/billing", require("./billing"));
 */
// router.use("/billing", require("./billing"));

module.exports = router;

// src/routes/index.js など
router.get("/ping-db", async (_, res) => {
  const db = require("../db");
  const { rows } = await db.query("SELECT NOW() AS now");
  res.json(rows[0]);           // { "now": "2025-07-08T07:30:00.000Z" }
});

