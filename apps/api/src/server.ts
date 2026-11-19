import Fastify from 'fastify';
import { redis, reserve, release, confirm } from './redis';
import { fakePayment } from './payment';

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
  return reply.code(200).send({ status: 'confirmed' });
});

app.get('/stock', async () => ({ stock: Number(await redis.get('stock')) }));

// Reaper: return stock for reservations that expired without payment.
setInterval(async () => {
  try {
    const expired = await redis.zrangebyscore('reservations', '-inf', Date.now());
    for (const key of expired) await release(key);
  } catch (e) {
    console.error('reaper error', e);
  }
}, 1000);

app.listen({ port: 3000, host: '0.0.0.0' }).then(() => console.log('API on :3000'));