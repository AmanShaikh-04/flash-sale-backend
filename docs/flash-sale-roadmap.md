# Flash-Sale Backend: Phased Roadmap

Last updated: 22 Nov 2026

**Goal:** prove the backend handles **1 million requests with no overselling**.
**Rule of thumb:** finish each phase's exit criteria before starting the next. CORE items are mandatory. KEEP items are built if time allows, otherwise use the fallback.

**Fixed decisions:** Node.js (TypeScript) | region ap-south-1 (Mumbai) | queue: SQS (RabbitMQ later as an experiment) | Terraform CLI + S3 backend | starting stock N = 10,000. Details in `docs/decisions.md`.

## Map at a glance

| Phase | Name | Where | AWS cost | Main outcome | Status |
|---|---|---|---|---|---|
| 0 | Prep and decisions | Laptop + AWS console | $0 | Accounts, budget alert, quota check | Done (quota approval pending) |
| 1 | Core app, local | Docker Compose (infra) + host | $0 | `/buy` works with zero oversell locally | **Done** |
| 2 | CI/CD and images | GitHub Actions | $0 | Every push builds and tests images | **Done** |
| 3 | Kubernetes, local | kind | $0 | Helm, HPA and Argo CD working | **Done** |
| 4 | Terraform + AWS smoke test | AWS (hours) | Low | 50-100k requests pass, then destroy | **Next** |
| 5 | Edge, security, payments | AWS | Low | Full request path hardened | Not started |
| 6 | Observability | Local + AWS | Low | Dashboards ready for evidence | Not started |
| 7 | Dress rehearsal and pre-flight | AWS | Moderate | Final-run checklist all green | Not started |
| 8 | Final run, evidence, teardown | AWS | About $50 | 1M requests, proof captured, all destroyed | Not started |

---

## Phase 0: Prep and decisions (DONE, one item pending)

**Objective:** remove blockers before writing code.

- [x] Create or confirm the AWS account. Credits: $200, expire 19 May 2027. Region: ap-south-1 (Mumbai). Plan: Free.
- [x] Set an AWS Budgets alert ($50 monthly cost budget).
- [x] Create a public GitHub repo: `AmanShaikh-04/flash-sale-backend`.
- [x] Decide the queue: **SQS** (RabbitMQ later as an experiment, see Phase 10).
- [x] Decide the Terraform backend: **S3 backend** (no HCP Terraform).
- [x] Look up service quotas: EC2 On-Demand Standard vCPUs was 5, **requested 32** (pending). If denied, upgrade to Paid and re-request. API Gateway throttling still to check.
- [x] Define the **success metric**: N = 10,000, so confirmed orders must equal 10,000 exactly, and stock must never go below 0.
- [x] Commit `docs/decisions.md` and these docs to the repo.
- [ ] Confirm the vCPU quota increase is approved. (Needed before Phase 4.)

**Exit criteria:** budget alert active, repo created, decisions written down, quota increase approved or Paid-plan fallback done.

---

## Phase 1: Core app, local (DONE)

**Objective:** a working buy flow with correct stock handling on your laptop.

Docker Compose runs the infrastructure (Redis, Postgres, ElasticMQ). The API and worker run on the host with `tsx`. They get containerised in Phase 2.

- [x] Repo scaffold: npm workspaces (`apps/api`, `apps/worker`, `packages/shared`, `scripts/`), TypeScript, `tsx`
- [x] `docker-compose.yml` with Redis 7, Postgres 16 and ElasticMQ
- [x] Postgres `orders` table with `UNIQUE(idempotency_key)` (`db/schema.sql`)
- [x] Backend app (Node.js / TypeScript, Fastify) with `POST /buy` and `GET /stock`
- [x] Atomic stock handling in a **Lua script** (reserve only if stock > 0, never a bare `DECR`)
- [x] Reservation with 60 s TTL. Stock is released if payment fails, and a reaper returns stock for expired reservations
- [x] **Idempotency keys** on `/buy` (Redis fast path, Postgres UNIQUE as last line of defence)
- [x] Queue behind a small `Queue` interface, SQS implementation against ElasticMQ, plus `orders-dlq` (`maxReceiveCount` 3)
- [x] Worker writes confirmed orders to PostgreSQL (`ON CONFLICT DO NOTHING`, ack after insert)
- [x] Fake payment service (50-150 ms, about 80% success)
- [x] `scripts/seed.ts` (reset stock, orders and queues) and `scripts/verify.ts` (7 checks)
- [x] `scripts/k6-buy.js` with unique keys per user and retries with the same key

**Results (local, one laptop):**

| Run | Requests | Stock | Confirmed | Result |
|---|---|---|---|---|
| 1 | 1,000 | 100 | 100 | All 7 checks passed |
| 2 | 10,000 | 2,000 | 2,000 | All 7 checks passed |
| 3 | 50,000 | 10,000 | 10,000 | All 7 checks passed |

Run 3: 0% failed requests, about 4,170 requests/s, p95 about 161 ms, 2,556 failed payments (all stock returned), 981 idempotent retries, final stock 0, no duplicates, queue and DLQ empty.

**Exit criteria (met):** zero overselling, zero duplicate orders, and failed payments return stock.

**Known limits:** one API process on one laptop. k6 and the app share the same machine. The fake payment is not a real gateway.

---

## Phase 2: Containers and CI/CD (CORE) (DONE)

**Objective:** automated, repeatable builds.

- [x] Production Dockerfile for the app and the worker (one multi-target file: `api` and `worker`)
- [x] App and worker added to Docker Compose behind an `app` profile, configured through environment variables (`REDIS_URL`, `DATABASE_URL`, `SQS_ENDPOINT`)
- [x] GitHub Actions: typecheck, lint, smoke test (compose + 1,000 requests + `verify.ts`), build and push
- [x] Images pushed to GHCR (`ghcr.io/amanshaikh-04/flash-sale-api` and `flash-sale-worker`, public). Switch to **ECR** (ap-south-1) in Phase 4.
- [x] Docker Hub pull limits avoided by pushing our own images

**Results:** first CI run on `main` passed in 2m 12s (check, smoke, publish for api and worker). Local container run: 1,000 requests, stock 100, all 7 verify checks passed.

**Exit criteria (met):** a push to `main` produces tested, tagged images automatically.

## Phase 3: Kubernetes on a local cluster (DONE)

**Objective:** prove the K8s setup at zero cost before touching AWS.

- [x] Run the stack on kind: app, worker, Redis (in-cluster), Postgres, queue (SQS emulator). `verify.ts` passed on the cluster at 5,000, 400,000 and 600,000 requests.
- [x] **HPA** (CORE): api scaled from 2 to 6 pods under k6 load (CPU reached 470% of request), then back to 2
- [x] Helm charts (KEEP, fallback: plain manifests): `deploy/helm/flash-sale`, `helm lint` clean
- [x] Argo CD (KEEP, fallback: deploy from CI): app Synced and Healthy. A merged change was applied with no deploy command, and a manual delete was self-healed.
- [x] Kubernetes secrets (the Secrets Manager fallback): Secret `flash-sale-db`

**Exit criteria (met):** `helm install` (or Argo sync) brings up the whole stack, and HPA scaling is visible during a local load test. Numbers are in `docs/decisions.md` under "Phase 3 results".

---

## Phase 4: Terraform and the AWS smoke test

**Objective:** get the stack running on AWS and find problems cheaply.

- [ ] Terraform S3 state bucket (create once, enable versioning, keep it across destroys)
- [ ] Terraform (CORE): VPC (private networking), IAM (least privilege), EKS, node group, ECR, RDS, SQS + DLQ
- [ ] ALB (CORE) in front of the backend pods
- [ ] Fixed node group sized for the test (the Karpenter fallback). Needs the vCPU quota increase.
- [ ] Redis in-cluster, not on a free hosted tier
- [ ] Deploy via CI or Argo CD
- [ ] Run **k6 from inside AWS**, on separate nodes or instances, at **50-100k requests**
- [ ] Run the verification script, fix bottlenecks, then **`terraform destroy`**
- [ ] Confirm nothing is left behind (NAT gateway, load balancer, EBS volumes)

**Exit criteria:** smoke test passes with no overselling, the stack comes up and tears down cleanly from Terraform alone, and measured cost matches expectations (about $1/hour with everything running; Mumbai may be slightly higher).

> Tip: keep sessions short. Bring it up, test for a couple of hours, and destroy.
> Note: `verify.ts` and `seed.ts` currently use localhost endpoints and the ElasticMQ queue URL. They need environment variables for the AWS endpoints (Redis, RDS, SQS) before this phase.

---

## Phase 5: Edge, security and payments

**Objective:** add the production-style layers. Work through these in priority order and skip anything that fights back.

| Order | Item | Fallback if skipped |
|---|---|---|
| 1 | **Waiting room / virtual queue** on Redis (best design showcase) | Plain rate limit |
| 2 | **PgBouncer / RDS Proxy** (relevant to DB connection load) | App-side pool |
| 3 | **WAF**, with the k6 generator allowlisted | None needed |
| 4 | **Razorpay test mode** + webhooks (confirm test mode is free first) | Fake payment service (already built) |
| 5 | **Secrets Manager** | Kubernetes secrets |
| 6 | **API Gateway** rate limiting | App or ALB rate limit |
| 7 | **CloudFront**, **Route 53**, **ACM** | Test straight against the ALB URL |
| 8 | **Kafka / MSK** for events and analytics (needs the Paid plan) | SQS only |
| 9 | OpenSearch, S3 | Skip entirely (not on the buy path) |

> Do Kafka/MSK last and only for a short window. It is the largest single hourly cost (about $0.61 of the roughly $1.05/hour total).

**Exit criteria:** the full request path works end to end with whichever KEEP items you chose, and the skipped ones are recorded with their fallbacks.

---

## Phase 6: Observability

**Objective:** have dashboards and evidence tooling ready before the final run.

- [ ] **Prometheus + Grafana** (CORE): request rate, error rate, latency, Redis stock level, queue depth, DLQ depth, pod count (HPA), DB connections
- [ ] OpenTelemetry instrumentation (KEEP)
- [ ] Jaeger tracing (KEEP)
- [ ] Loki logs (KEEP)
- [ ] Alertmanager (KEEP)
- [ ] A saved Grafana dashboard that tells the story of the run (stock down, orders up, autoscaling, no errors)

**Exit criteria:** one dashboard shows the whole run, and you have rehearsed capturing screenshots or exports.

> Tip: install Prometheus + Grafana as early as Phase 3 or 4 if you want data from the smoke tests. Only the optional tools belong at the end.

---

## Phase 7: Dress rehearsal and pre-flight

**Objective:** make the final run boring.

- [ ] Bring up the **full** stack on AWS and run a larger test (for example 200-300k requests) to find the next bottleneck
- [ ] Tune: HPA thresholds, node count, DB pool, Redis connection limits
- [ ] Pre-flight checklist:
  - [ ] AWS budget alert set ($50)
  - [ ] k6 generator allowlisted in WAF (one IP sending 1M requests looks like an attack)
  - [ ] k6 runs from inside AWS, on separate nodes
  - [ ] Service quotas confirmed (API Gateway throttling, EC2 vCPUs for node scale-up)
  - [ ] Redis running in-cluster
  - [ ] Dashboards loaded, verification script tested
  - [ ] Destroy-and-check-leftovers steps written down
  - [ ] Credits still valid (expire 19 May 2027)
- [ ] Destroy after rehearsal if the final run is not happening the same day

**Exit criteria:** rehearsal passes with no overselling, with headroom, and the checklist is fully ticked.

---

## Phase 8: Final run, evidence, teardown

**Objective:** the one run that counts.

1. [ ] Bring up the stack with Terraform and confirm health.
2. [ ] Start dashboard recording or screenshots.
3. [ ] Run **k6 at 1M requests** with starting stock N = 10,000.
4. [ ] Run the verification script and save the output. It must show:
   - confirmed orders == 10,000 (initial stock)
   - stock never below 0
   - no duplicate orders (idempotency holds)
   - DLQ empty or fully explained
5. [ ] Capture dashboards: throughput, latency percentiles, error rate, autoscaling, Redis stock.
6. [ ] **`terraform destroy`**
7. [ ] Verify nothing remains: NAT gateway, load balancers, EBS volumes, MSK cluster, ECR images, RDS snapshots.
8. [ ] Delete the Terraform S3 state bucket once everything else is gone.
9. [ ] Check the billing console the next day for stray charges.

**Exit criteria:** evidence saved, all AWS resources gone, costs confirmed.

---

## Phase 9 (optional): Write-up

- [ ] README with architecture diagram and the core flow
- [ ] Results: numbers, dashboards, verification output
- [ ] Decisions and trade-offs (own waiting room, in-cluster Redis, SQS first, fallbacks used)
- [ ] Lessons learned and bottlenecks found

---

## Phase 10 (optional): RabbitMQ experiment

Only after the 1M proof is captured and the main environment is destroyed.

- [ ] Add a RabbitMQ implementation behind the existing queue interface
- [ ] Run it locally (Docker Compose or kind) with the same k6 and verification scripts
- [ ] Compare against SQS: throughput, latency, operational effort
- [ ] Add the findings to the write-up

---

## Scope-cut order (if time or money gets tight)

Drop these first, in this order. The main goal still stands without them:

0. RabbitMQ experiment (Phase 10)
1. OpenSearch, S3
2. Jaeger, Loki, OpenTelemetry, Alertmanager
3. CloudFront, Route 53, ACM
4. Kafka / MSK (use SQS only)
5. API Gateway (rate limit in the app or ALB)
6. Razorpay (use the fake payment service)
7. Argo CD, Helm, Karpenter, Secrets Manager

**Never drop:** Docker, Kubernetes + HPA, Terraform, VPC, IAM, ALB, Redis, PostgreSQL, queue + DLQ, idempotency keys, CI/CD, ECR, Prometheus + Grafana, k6.

## Definition of done

The project is done when a 1M-request k6 run from inside AWS produces **exactly 10,000 confirmed orders (the starting stock)**, never negative stock, and no duplicates, with dashboards captured and the AWS environment fully destroyed.

## Open items to verify

- Pricing for ACM, Route 53, CloudFront, S3, ECR, SQS, RDS Proxy and CloudWatch has not been checked.
- Mumbai (ap-south-1) prices have not been checked. The estimates are US East rates and Mumbai may be slightly higher.
- Whether Razorpay test mode is free has not been confirmed.
- The about-5-worker-node count is an assumption.
- AWS prices came from third-party summaries and may differ slightly from the live pages.
- The EC2 vCPU quota increase (5 to 32) is pending approval.
- Local throughput (about 4,170 requests/s on one laptop) says nothing yet about AWS. The 1M run depends on pod count, Redis and DB limits, to be measured in Phases 4 and 7.
