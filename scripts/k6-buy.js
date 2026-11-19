import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const TOTAL = Number(__ENV.TOTAL || 1000);
const VUS = Number(__ENV.VUS || 50);
const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const RUN = __ENV.RUN || String(Date.now());

export const options = {
  scenarios: {
    buy: { executor: 'shared-iterations', vus: VUS, iterations: TOTAL, maxDuration: '30m' },
  },
};

// 402, 409 and 410 are expected answers, not failures.
http.setResponseCallback(http.expectedStatuses(200, 202, 402, 409, 410));

const confirmed = new Counter('r_confirmed');
const soldOut = new Counter('r_sold_out');
const payFailed = new Counter('r_payment_failed');
const already = new Counter('r_already');

function buy(userId, key) {
  const res = http.post(`${BASE}/buy`, JSON.stringify({ userId, idempotencyKey: key }), {
    headers: { 'Content-Type': 'application/json' },
  });
  let status = 'unknown';
  try { status = res.json('status'); } catch (e) {}
  if (status === 'confirmed') confirmed.add(1);
  else if (status === 'sold_out') soldOut.add(1);
  else if (status === 'payment_failed') payFailed.add(1);
  else if (status === 'already') already.add(1);
}

export default function () {
  const i = exec.scenario.iterationInTest;
  const key = `r${RUN}-${i}`;
  buy(`user${i}`, key);
  // Every 10th user retries with the SAME key to test idempotency.
  if (i % 10 === 0) buy(`user${i}`, key);
}
