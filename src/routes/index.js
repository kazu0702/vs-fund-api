const express = require("express");
const router  = express.Router();

router.get("/ping", (_, res) => res.json({ pong: true })); 
router.use("/billing",      require("./billing"));
router.use("/emailChange",  require("./emailChange")); 

module.exports = router;
