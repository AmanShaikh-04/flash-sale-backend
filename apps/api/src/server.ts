import Fastify from 'fastify';
import { redis, reserve, release, confirm } from './redis';
import { fakePayment } from './payment';
import { createSqsQueue } from '@flash/shared';

const queuePromise = createSqsQueue();

const app = Fastify();

app.post('/buy', async (req, reply) => {
  const { userId, idempotencyKey } = (req.body ?? {}) as {
    userId?: string;
    idempotencyKey?: string;
  };
  if (!userId || !idempotencyKey) {
    return reply.code(400).send({ error: 'userId and idempotencyKey required' });
  }

  const result = await reserve(idempotencyKey);
  if (result === 'SOLD_OUT') return reply.code(409).send({ status: 'sold_out' });
  if (result === 'ALREADY') return reply.code(200).send({ status: 'already' });

  const paid = await fakePayment();
  if (!paid) {
    await release(idempotencyKey);
    return reply.code(402).send({ status: 'payment_failed' });
  }

    const confirmed = await confirm(idempotencyKey);
  if (!confirmed) return reply.code(410).send({ status: 'reservation_expired' });

  const queue = await queuePromise;
  await queue.publish({ userId, idempotencyKey });
  return reply.code(200).send({ status: 'confirmed' });
});

app.get('/stock', async () => ({ stock: Number(await redis.get('stock')) }));

// Kubernetes probes. Liveness: the process is up. Readiness: Redis answers.
app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async (_req, reply) => {
  try {
    await redis.ping();
    return { ok: true };
  } catch {
    return reply.code(503).send({ ok: false });
  }
});

// Reaper: return stock for reservations that expired without payment.
setInterval(async () => {
  try {
    const expired = await redis.zrangebyscore('reservations', '-inf', Date.now());
    for (const key of expired) await release(key);
  } catch (e) {
    console.error('reaper error', e);
  }
}, 1000);

// On SIGTERM (HPA scale-down, rollout) stop taking new requests and finish the ones in flight.
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, draining');
  await app.close();
  process.exit(0);
});

app.listen({ port: 3000, host: '0.0.0.0' }).then(() => console.log('API on :3000'));