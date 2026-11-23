import Redis from 'ioredis';
import { Pool } from 'pg';
import { PurgeQueueCommand } from '@aws-sdk/client-sqs';
import { createSqsClient } from '@flash/shared';

const N = Number(process.env.STOCK ?? 10000);
const base = process.env.SQS_BASE ?? 'http://localhost:9324/000000000000';

async function main() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://flash:flash@localhost:5432/flashsale',
  });
  const sqs = createSqsClient();

  await redis.flushall();
  await redis.set('stock', N);
  await pool.query('TRUNCATE orders RESTART IDENTITY');
  for (const q of ['orders', 'orders-dlq']) {
    try {
      await sqs.send(new PurgeQueueCommand({ QueueUrl: `${base}/${q}` }));
    } catch (e) {
      console.log(`purge ${q} skipped (queue may not exist yet)`);
    }
  }

  console.log(`seeded: stock=${N}, orders cleared, queues purged`);
  await redis.quit();
  await pool.end();
}

main();
