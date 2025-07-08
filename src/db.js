// src/db.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }   // Render Postgres は必須
});

pool.connect()
  .then(() => console.log("[DEBUG] Postgres connected"))
  .catch(err => {
    console.error("PG connect error:", err);
    process.exit(1);
  });

module.exports = pool;
