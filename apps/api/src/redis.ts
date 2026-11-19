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

// Release: only if the reservation still exists, so stock is returned exactly once.
const RELEASE_LUA = `
if redis.call('ZREM', KEYS[2], ARGV[1]) == 1 then
  redis.call('INCR', KEYS[1])
  redis.call('DEL', KEYS[3])
  return 1
end
return 0
`;

// Confirm: only if the reservation is still alive (not expired or released).
const CONFIRM_LUA = `
if redis.call('ZREM', KEYS[1], ARGV[1]) == 1 then
  redis.call('SET', KEYS[2], 'CONFIRMED', 'EX', ARGV[2])
  return 1
end
return 0
`;

redis.defineCommand('release', { numberOfKeys: 3, lua: RELEASE_LUA });
redis.defineCommand('confirm', { numberOfKeys: 2, lua: CONFIRM_LUA });

export async function release(idempotencyKey: string): Promise<boolean> {
  return (await (redis as any).release('stock', 'reservations', `idem:${idempotencyKey}`, idempotencyKey)) === 1;
}

export async function confirm(idempotencyKey: string): Promise<boolean> {
  return (await (redis as any).confirm('reservations', `idem:${idempotencyKey}`, idempotencyKey, 3600)) === 1;
}