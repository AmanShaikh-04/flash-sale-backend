import { Pool } from 'pg';
import { createSqsQueue } from '@flash/shared';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://flash:flash@localhost:5432/flashsale',
  max: 10,
});

async function main() {
  const queue = await createSqsQueue();
  console.log('worker started');

  await queue.consume(async ({ body, ack }) => {
    // The UNIQUE key makes retries and duplicates harmless.
    await pool.query(
      'INSERT INTO orders (user_id, idempotency_key) VALUES ($1, $2) ON CONFLICT (idempotency_key) DO NOTHING',
      [body.userId, body.idempotencyKey]
    );
    await ack(); // delete from the queue only after the insert succeeds
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});