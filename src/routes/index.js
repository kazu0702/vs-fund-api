/*──────────────────────────────────────────
  ルート集約 – src/routes/index.js
──────────────────────────────────────────*/
const express = require("express");
const router  = express.Router();

/* ─── メールアドレス変更 ─── */
router.use("/emailChange", require("./emailChange"));

/* ─── 動作確認エンドポイント ─── */
router.get("/ping-db", async (_, res) => {
  const db = require("../db");
  const { rows } = await db.query("SELECT NOW() AS now");
  res.json(rows[0]);                // { "now": "2025-07-26T07:30:00.000Z" }
});

module.exports = router;
