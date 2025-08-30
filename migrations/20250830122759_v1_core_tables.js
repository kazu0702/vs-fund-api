/**
 * Initial schema v1 for VS Fund
 */
exports.up = async function(knex) {
  await knex.schema.createTable('members', (t) => {
    t.increments('id').primary();
    t.string('memberstack_id').notNullable().unique();
    t.string('email').notNullable().unique();
    t.string('status').notNullable().defaultTo('active');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw("ALTER TABLE members ADD CONSTRAINT members_status_chk CHECK (status IN ('active','inactive','deleted'))");

  await knex.schema.createTable('subscriptions', (t) => {
    t.increments('id').primary();
    t.integer('member_id').notNullable().references('id').inTable('members').onDelete('CASCADE');
    t.string('stripe_customer_id').notNullable();
    t.string('stripe_subscription_id').notNullable().unique();
    t.string('plan').notNullable();
    t.string('status').notNullable();
    t.timestamp('current_period_end', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['member_id'], 'idx_subscriptions_member_id');
    t.index(['status'], 'idx_subscriptions_status');
  });
  await knex.raw("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('monthly','yearly'))");
  await knex.raw("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_chk CHECK (status IN ('active','past_due','canceled','incomplete','incomplete_expired','trialing','unpaid'))");

  await knex.schema.createTable('payments', (t) => {
    t.increments('id').primary();
    t.integer('subscription_id').notNullable().references('id').inTable('subscriptions').onDelete('CASCADE');
    t.string('stripe_payment_intent_id').notNullable().unique();
    t.integer('amount').notNullable();
    t.string('currency').notNullable().defaultTo('jpy');
    t.string('status').notNullable();
    t.timestamp('paid_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['subscription_id'], 'idx_payments_subscription_id');
    t.index(['status'], 'idx_payments_status');
  });
  await knex.raw("ALTER TABLE payments ADD CONSTRAINT payments_status_chk CHECK (status IN ('paid','failed','refunded'))");

  await knex.schema.createTable('webhook_events', (t) => {
    t.increments('id').primary();
    t.string('provider').notNullable();
    t.string('event_id').notNullable().unique();
    t.string('type').notNullable();
    t.jsonb('payload').notNullable();
    t.timestamp('processed_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['provider'], 'idx_webhook_events_provider');
    t.index(['type'], 'idx_webhook_events_type');
    t.index(['processed_at'], 'idx_webhook_events_processed_at');
  });
  await knex.raw("ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_provider_chk CHECK (provider IN ('stripe','memberstack'))");

  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.string('actor_type').notNullable();
    t.integer('actor_id');
    t.string('action').notNullable();
    t.jsonb('meta');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['actor_type'], 'idx_audit_logs_actor_type');
    t.index(['created_at'], 'idx_audit_logs_created_at');
  });
  await knex.raw("ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_chk CHECK (actor_type IN ('user','system'))");
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('webhook_events');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('subscriptions');
  await knex.schema.dropTableIfExists('members');
};
