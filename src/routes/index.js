const express = require("express");
const router  = express.Router();

router.use("/billing",      require("./billing"));
router.use("/emailChange",  require("./emailChange"));   // ★ 追加

module.exports = router;
