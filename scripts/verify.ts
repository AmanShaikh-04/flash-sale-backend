import Redis from 'ioredis';
import { Pool } from 'pg';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const N = Number(process.env.STOCK ?? 10000);
const base = process.env.SQS_BASE ?? 'http://localhost:9324/000000000000';

async function main() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://flash:flash@localhost:5432/flashsale',
  });
  const sqs = new SQSClient({
    region: 'ap-south-1',
    endpoint: 'http://localhost:9324',
    credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
  });

  async function depth(name: string): Promise<number> {
    const r = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: `${base}/${name}`,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      })
    );
    const a = r.Attributes ?? {};
    return Number(a.ApproximateNumberOfMessages ?? 0) + Number(a.ApproximateNumberOfMessagesNotVisible ?? 0);
  }

  const orders = Number((await pool.query('SELECT count(*) FROM orders')).rows[0].count);
  const dupes = Number(
    (await pool.query('SELECT count(*) - count(DISTINCT idempotency_key) AS d FROM orders')).rows[0].d
  );
  const stock = Number((await redis.get('stock')) ?? 0);
  const pending = await redis.zcard('reservations');
  const queueDepth = await depth('orders');
  const dlqDepth = await depth('orders-dlq');

  const checks: [string, boolean, string][] = [
    ['orders == starting stock (N)', orders === N, `${orders} vs ${N}`],
    ['stock never negative', stock >= 0, `stock=${stock}`],
    ['sold + remaining == N', orders + stock === N, `${orders} + ${stock}`],
    ['no duplicate orders', dupes === 0, `duplicates=${dupes}`],
    ['no pending reservations', pending === 0, `pending=${pending}`],
    ['queue drained', queueDepth === 0, `depth=${queueDepth}`],
    ['DLQ empty', dlqDepth === 0, `depth=${dlqDepth}`],
  ];

  let ok = true;
  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');

  await redis.quit();
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main();