import Fastify from 'fastify';
import { redis, reserve } from './redis';

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
  return reply.code(result === 'RESERVED' ? 202 : 200).send({ status: result.toLowerCase() });
});

app.get('/stock', async () => ({ stock: Number(await redis.get('stock')) }));

app.listen({ port: 3000, host: '0.0.0.0' }).then(() => console.log('API on :3000'));