# Decisions

Last updated: 20 Nov 2026

## Status
- Phase 0: done (only the vCPU quota approval is still open).
- Phase 1: **done**. 50,000-request local run, zero overselling (see "Phase 1 results").
- Phase 2: **done**. (Dockerfiles, GitHub Actions, GHCR).
- Next: Phase 3 (Kubernetes on kind or k3d, Helm, HPA).

## Project
- **Goal:** prove the flash-sale backend handles 1M requests with no overselling.
- **Repo:** https://github.com/AmanShaikh-04/flash-sale-backend (public, MIT license)
- **Language:** Node.js (TypeScript)

## AWS account
- **Region:** ap-south-1 (Mumbai). Use it for everything, including quota requests.
- **Plan:** Free (credits cover usage). Upgrade to Paid if needed (see quota below, or if MSK is used). Do NOT upgrade by joining AWS Organizations, because credits would expire immediately.
- **Credits:** $200.00 USD, expiring **19 May 2027**.
- **Budget alert:** $50 monthly cost budget (set up).
- **Pricing note:** the cost estimates in the overview are US East rates. Mumbai may be slightly higher, so verify before the final run.

## Technical decisions
| Decision | Choice | Why |
|---|---|---|
| Queue | **SQS** | Managed, built-in dead-letter queue, nothing to run or patch |
| Local queue | ElasticMQ (SQS-compatible) in Docker Compose | Same code works locally and on AWS |
| Queue code | Behind a small `Queue` interface (`publish`, `consume`) in `packages/shared` | Makes the later RabbitMQ swap easy |
| RabbitMQ | **Later**, as an optional experiment after the 1M proof | Explore it without risking the main goal |
| IaC | Terraform CLI | Core requirement |
| Terraform state | **S3 backend** (no HCP Terraform) | Free apart from pennies, and HCP's free tier is being discontinued |
| State bucket | Created once, kept across `terraform destroy`, deleted at the very end | Keeps `destroy` reliable |
| Redis | In-cluster | Free hosted tiers are too small |
| Waiting room | Own build on Redis | Paid options cost $190-200/month |
| SES | Removed | No real users, no emails needed |
| Web framework | **Fastify 5** | Low overhead for a Redis-heavy `/buy` endpoint |
| Redis client | **ioredis 6**, Lua scripts registered with `defineCommand` | Atomic multi-step operations in one round trip |
| Stock reservation | **Lua script, not a bare `DECR`** | A bare `DECR` briefly drives stock to -1, which breaks "never below 0". The script decrements only if stock > 0 |
| Release and confirm | Also Lua, both guarded by `ZREM` on the reservation | Stock is returned exactly once, even if a payment failure and the reaper race |
| Reservation expiry | 60 s TTL, tracked in a sorted set `reservations` scored by expiry time. A reaper loop in the API (every 1 s) releases expired ones | Redis key expiry alone does not return stock |
| Idempotency | Redis key `idem:<key>` (1 h TTL) as the fast path, plus `UNIQUE(idempotency_key)` in Postgres as the last line of defence. The worker inserts with `ON CONFLICT DO NOTHING` | Duplicates are harmless at every layer |
| Payment (for now) | Fake service: 50-150 ms delay, about 80% success | Fallback from the overview. Razorpay test mode comes in Phase 5 |
| DLQ | `orders-dlq`, `maxReceiveCount` 3, visibility timeout 30 s | Failed messages are retried, then parked |
| Worker ack | Message is deleted only after the Postgres insert succeeds | A crash or error means a retry, never a lost order |
| Repo layout | npm workspaces: `apps/api`, `apps/worker`, `packages/shared`, `scripts/` | One install, shared code |
| TypeScript | `module: nodenext`, `strict`, `types: ["node"]`, `verbatimModuleSyntax` off. Run with `tsx`, no build step yet | The default `tsc --init` file caused import and type errors |
| Local Compose scope | Runs **infra only** (Redis, Postgres, ElasticMQ). API and worker run on the host with `tsx` | Containerising the app is Phase 2 |
| k6 script | `shared-iterations`. Every 10th iteration retries with the same key. 402, 409 and 410 count as expected responses | Tests idempotency and avoids false failures |
| Test scaling rule | Payments fail about 20%, so stock sells out only with enough requests. Smaller runs use smaller stock. The final run uses N = 10,000 | Keeps every run meaningful |

## `/buy` behaviour
| Response | HTTP | Meaning |
|---|---|---|
| `confirmed` | 200 | Reserved, paid, order published to the queue |
| `already` | 200 | Same idempotency key seen before (no extra stock taken) |
| `sold_out` | 409 | Stock is 0 |
| `payment_failed` | 402 | Stock returned to Redis |
| `reservation_expired` | 410 | Reservation lapsed before payment finished |
| (bad input) | 400 | `userId` or `idempotencyKey` missing |

Note: only keys that reserved stock are remembered. A `sold_out` key is not, so its retry also gets `sold_out`. This is correct and cannot cause overselling.

## Success metric
- Starting stock **N = 10,000**.
- Confirmed orders must equal exactly **10,000**.
- Stock must never go below 0.
- No duplicate orders (idempotency keys hold).
- DLQ empty or fully explained.

`scripts/verify.ts` checks seven things: orders == N, stock >= 0, orders + stock == N, no duplicate keys, no pending reservations, queue drained, DLQ empty.

## Phase 1 results (local, one laptop)
| Run | Requests | Stock | Confirmed | Result |
|---|---|---|---|---|
| 1 | 1,000 | 100 | 100 | All checks passed |
| 2 | 10,000 | 2,000 | 2,000 | All checks passed |
| 3 | 50,000 (55,000 HTTP calls with retries) | 10,000 | 10,000 | All checks passed |

Run 3 detail: 0% failed requests, about 4,170 requests/s, p95 about 161 ms. Of 55,000 calls: 10,000 confirmed, 2,556 payment failures (all stock returned), 41,463 sold out, 981 `already` (idempotent retries). Final stock 0, no duplicates, queue and DLQ empty.

## Service quotas
- EC2 "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z)" in ap-south-1: default **5 vCPUs**.
- **Requested 32 vCPUs.** Status: pending (check Service Quotas -> Quota request history).
- If denied or stalled for a day or two: upgrade to Paid plan (Billing -> Upgrade plan) and request again.
- Still to check later: API Gateway throttling limits.

## Local environment
- Windows, PowerShell. Repo at `C:\Users\as333\Desktop\flash-sale-backend`.
- Node v24.18.0, TypeScript 7.0.2, Docker 29.9.1, Compose v5.6.0, k6 v2.4.0.
- Dependencies: fastify 5, ioredis 6, pg 8, @aws-sdk/client-sqs 3, tsx.
- Ports: API 3000, Redis 6379, Postgres 5432 (user/password `flash`, db `flashsale`), ElasticMQ SQS 9324. The ElasticMQ web UI on 9325 does not respond and is not needed.
- Another project's container uses port 5433. It does not clash.
- Git pushes must be signed in as `AmanShaikh-04`. Windows Credential Manager once held a different account, which caused a 403.

## Local run commands
Docker containers (Redis, Postgres, ElasticMQ) keep running when terminals close. The API and worker do not.

```powershell
cd C:\Users\as333\Desktop\flash-sale-backend
docker compose up -d
# only after a "docker compose down" (data is wiped) re-apply the schema:
Get-Content db\schema.sql | docker compose exec -T postgres psql -U flash -d flashsale
```

Terminal A (leave open): `npm run dev --workspace apps/api`  (prints `API on :3000`)
Terminal B (leave open): `npm run dev --workspace apps/worker`  (prints `worker started`)
Terminal C (test):

```powershell
$env:STOCK = "10000"
npx tsx scripts/seed.ts
k6 run -e TOTAL=50000 -e VUS=200 scripts/k6-buy.js
Start-Sleep -Seconds 30
npx tsx scripts/verify.ts
Remove-Item Env:STOCK
```

## Lessons learned so far
- With npm workspaces, create the new package's `package.json` **before** running `npm install --workspace`. Otherwise npm skips the install, and you get "Cannot find module" errors.
- A closed terminal stops the API and worker. "Connection refused" from k6 means the API is not running.
- `docker compose down` wipes Redis and Postgres data (there are no volumes). Re-apply `db/schema.sql` after the next `up`.
- The reaper runs inside each API process. With several pods, several reapers run, which is safe because release is atomic. Revisit at scale if it costs too much.

## Phase 2 results
- **Image:** one multi-target Dockerfile (`api`, `worker`) on `node:24-slim`. Production dependencies only (`npm ci --omit=dev`). It runs with `node --import tsx` (no build step yet), so `tsx` was moved to `dependencies`.
- **Compose:** `docker compose up -d` is still infra only. `--profile app` adds api and worker. Postgres applies `db/schema.sql` automatically on first start. Redis and Postgres have healthchecks. The app and worker use `restart: on-failure`, because they exit if ElasticMQ is not ready at startup.
- **Lint and types:** Biome for lint (typescript-eslint does not support TypeScript 7 yet), `tsc --noEmit` for types. `scripts/k6-buy.js` and `docs/` are excluded from lint. 10 warnings remain (`any`, non-null assertions, one unused variable). They do not block CI.
- **CI** (`.github/workflows/ci.yml`): check -> smoke -> publish. The smoke test starts compose, seeds stock 100, runs 1,000 requests through k6 (in Docker), then runs `verify.ts`. Publish runs on `main` only.
- **Registry:** GHCR, public. Tags: `latest` and `sha-<commit>`. Images are amd64 only. Switch to ECR in Phase 4.
- **Known gap:** `seed.ts` and `verify.ts` still hardcode `http://localhost:9324` for SQS. They need env vars before the Phase 4 AWS run.
