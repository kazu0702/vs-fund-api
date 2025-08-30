// knexfile.js
require('dotenv').config();

const common = {
  client: 'pg',
  pool: { min: 1, max: 5, idleTimeoutMillis: 300000 },
  migrations: { tableName: 'knex_migrations', directory: './migrations' },
};

module.exports = {
  development: {
    ...common,
    connection: {
      connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/devdb',
      application_name: process.env.PGAPPNAME || 'vs-fund-api',
      // ローカルの External URL を使うなら↓を有効化
      // ssl: { require: true, rejectUnauthorized: false },
    },
  },
  production: {
    ...common,
    connection: {
      connectionString: process.env.DATABASE_URL,
      application_name: process.env.PGAPPNAME || 'vs-fund-api',
      // Render の External URL を使うなら必要。Internal URL なら無くてもOK
      ssl: { require: true, rejectUnauthorized: false },
    },
  },
};
