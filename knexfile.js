require('dotenv').config();

const common = {
  client: 'pg',
  pool: { min: 2, max: 10 },
  migrations: { tableName: 'knex_migrations', directory: './migrations' },
};

module.exports = {
  development: {
    ...common,
    connection: process.env.DATABASE_URL || 'postgres://localhost:5432/devdb',
  },
  production: {
    ...common,
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { require: true, rejectUnauthorized: false },
    },
  },
};
