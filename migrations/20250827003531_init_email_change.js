exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('email_change');
  if (!exists) {
    await knex.schema.createTable('email_change', (t) => {
      t.bigIncrements('id').primary();
      t.text('member_id').notNullable();
      t.text('old_email');
      t.text('new_email').notNullable();
      t.text('token').notNullable().unique();
      t.text('status').notNullable().defaultTo('pending');
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.schema.alterTable('email_change', (t) => {
      t.index(['member_id'], 'idx_email_change_member_id');
      t.index(['token'],     'idx_email_change_token');
    });
  }
};
exports.down = async function (knex) {
  const exists = await knex.schema.hasTable('email_change');
  if (exists) await knex.schema.dropTable('email_change');
};
