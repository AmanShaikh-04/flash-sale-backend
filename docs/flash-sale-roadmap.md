# Flash-Sale Backend: Phased Roadmap

**Goal:** prove the backend handles **1 million requests with no overselling**.
**Rule of thumb:** finish each phase's exit criteria before starting the next. CORE items are mandatory. KEEP items are built if time allows, otherwise use the fallback.

**Fixed decisions:** Node.js (TypeScript) | region ap-south-1 (Mumbai) | queue: SQS (RabbitMQ later as an experiment) | Terraform CLI + S3 backend | starting stock N = 10,000. Details in `docs/decisions.md`.

## Map at a glance

| Phase | Name | Where | AWS cost | Main outcome |
|---|---|---|---|---|
| 0 | Prep and decisions | Laptop + AWS console | $0 | Accounts, budget alert, quota check |
| 1 | Core app, local | Docker Compose | $0 | `/buy` works with zero oversell locally |
| 2 | CI/CD and images | GitHub Actions | $0 | Every push builds and tests images |
| 3 | Kubernetes, local | kind / k3d | $0 | Helm, HPA and Argo CD working |
| 4 | Terraform + AWS smoke test | AWS (hours) | Low | 50-100k requests pass, then destroy |
| 5 | Edge, security, payments | AWS | Low | Full request path hardened |
| 6 | Observability | Local + AWS | Low | Dashboards ready for evidence |
| 7 | Dress rehearsal and pre-flight | AWS | Moderate | Final-run checklist all green |
| 8 | Final run, evidence, teardown | AWS | About $50 | 1M requests, proof captured, all destroyed |

---

## Phase 0: Prep and decisions (IN PROGRESS)

**Objective:** remove blockers before writing code.

- [x] Create or confirm the AWS account. Credits: $200, expire 19 May 2027. Region: ap-south-1 (Mumbai). Plan: Free.
- [x] Set an AWS Budgets alert ($50 monthly cost budget).
- [x] Create a public GitHub repo: `AmanShaikh-04/flash-sale-backend`.
- [x] Decide the queue: **SQS** (RabbitMQ later as an experiment, see Phase 10).
- [x] Decide the Terraform backend: **S3 backend** (no HCP Terraform).
- [x] Look up service quotas: EC2 On-Demand Standard vCPUs was 5, **requested 32** (pending). If denied, upgrade to Paid and re-request. API Gateway throttling still to check.
- [x] Define the **success metric**: N = 10,000, so confirmed orders must equal 10,000 exactly, and stock must never go below 0.
- [ ] Commit `docs/decisions.md` and these docs to the repo.
- [ ] Confirm the vCPU quota increase is approved.

**Exit criteria:** budget alert active, repo created, decisions written down, quota increase approved or Paid-plan fallback done.

---

## Phase 1: Core app on Docker Compose (CORE)

**Objective:** a working buy flow with correct stock handling on your laptop.

- [ ] Backend app (Node.js / TypeScript) with `/buy`
- [ ] Redis atomic `DECR` stock counter. Reject when stock goes below 0.
- [ ] Reservation with TTL. Release stock if payment fails or the TTL expires.
- [ ] **Idempotency keys** on `/buy` (no duplicate orders)
- [ ] Queue: **SQS-compatible** (ElasticMQ or LocalStack) plus a **dead-letter queue**, behind a small queue interface
- [ ] Worker writes confirmed orders to PostgreSQL
- [ ] Fake payment service that randomly succeeds or fails (the fallback is fine for now)
- [ ] k6 script, plus a small **verification script** that checks: orders in Postgres == stock sold, no negative stock, no duplicate idempotency keys

**Exit criteria:** local k6 run (e.g. 10-50k requests, stock N = 10,000) shows zero overselling and zero duplicate orders, and failed payments return stock.

---

## Phase 2: Containers and CI/CD (CORE)

**Objective:** automated, repeatable builds.

- [ ] Production Dockerfiles for the app and the worker
- [ ] GitHub Actions: lint, test, build image on every push (public repo, so minutes are free)
- [ ] Push images to a registry. Use GHCR for now, and switch to **ECR** (ap-south-1) in Phase 4.
- [ ] Avoid Docker Hub pull limits by pushing your own images

**Exit criteria:** a push to `main` produces tested, tagged images automatically.

---

## Phase 3: Kubernetes on a local cluster

**Objective:** prove the K8s setup at zero cost before touching AWS.

- [ ] Run the stack on kind or k3d: app, worker, Redis (in-cluster), Postgres, queue (SQS emulator)
- [ ] **HPA** (CORE): confirm pods scale up under k6 load
- [ ] Helm charts (KEEP, fallback: plain manifests)
- [ ] Argo CD (KEEP, fallback: deploy from CI)
- [ ] Kubernetes secrets (the Secrets Manager fallback)

**Exit criteria:** `helm install` (or Argo sync) brings up the whole stack, and HPA scaling is visible during a local load test.

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

---

## Phase 5: Edge, security and payments

**Objective:** add the production-style layers. Work through these in priority order and skip anything that fights back.

| Order | Item | Fallback if skipped |
|---|---|---|
| 1 | **Waiting room / virtual queue** on Redis (best design showcase) | Plain rate limit |
| 2 | **PgBouncer / RDS Proxy** (relevant to DB connection load) | App-side pool |
| 3 | **WAF**, with the k6 generator allowlisted | None needed |
| 4 | **Razorpay test mode** + webhooks (confirm test mode is free first) | Fake payment service |
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
