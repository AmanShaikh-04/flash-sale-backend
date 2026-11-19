import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// Atomic: dedupe by idempotency key, decrement only if stock > 0, then reserve.
const RESERVE_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 'ALREADY' end
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
if stock <= 0 then return 'SOLD_OUT' end
redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], 'RESERVED', 'EX', ARGV[3])
redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1])
return 'RESERVED'
`;

redis.defineCommand('reserve', { numberOfKeys: 3, lua: RESERVE_LUA });

export type ReserveResult = 'RESERVED' | 'ALREADY' | 'SOLD_OUT';

export async function reserve(idempotencyKey: string): Promise<ReserveResult> {
  const reservationTtlMs = 60_000; // reservation lives 60s
  const idemTtlSec = 3600;         // remember the key for 1 hour
  return (redis as any).reserve(
    'stock',
    `idem:${idempotencyKey}`,
    'reservations',
    idempotencyKey,
    Date.now() + reservationTtlMs,
    idemTtlSec
  );
}