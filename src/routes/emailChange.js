const express = require("express");
const { confirmEmailChange } = require("../controllers/emailChangeController");
const router = express.Router();

// /api/emailChange/confirm?token=xxxx
router.get("/confirm", confirmEmailChange);

module.exports = router;