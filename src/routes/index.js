const express = require("express");
const router  = express.Router();

// 既存
router.use("/emailChange", require("./emailChange"));

// ★ここに追加
router.get("/ping-db", async (_, res) => {
  const db = require("../db");
  const { rows } = await db.query("SELECT NOW() AS now");
  res.json(rows[0]);           // { "now": "2025-07-08T07:30:00.000Z" }
});

module.exports = router;
