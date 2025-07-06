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
