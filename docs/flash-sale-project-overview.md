# Flash-Sale Backend: Project Overview

Last updated: 22 Nov 2026

## Progress
- Phase 0 (prep): done, except the pending EC2 vCPU quota approval.
- Phase 1 (core app, local): **done**. 50,000 requests, exactly 10,000 confirmed orders, no overselling, no duplicates, queue and DLQ empty. See `docs/decisions.md` for the numbers.
- Phase 2 (containers and CI/CD): **done**. Dockerfile, GitHub Actions (check, smoke, publish), images on GHCR.
- Phase 3 (local Kubernetes): **done**. Helm chart on kind, HPA scaled the api from 2 to 6 pods under load, Argo CD deploys from `main`, `verify.ts` passed on the cluster.
- Next: Phase 4 (Terraform and the AWS smoke test). Full plan in `docs/flash-sale-roadmap.md`.

## 1. Goal

Prove that a flash-sale backend (ticket / sneaker drop) can handle **1 million requests with no overselling**.

- The app itself is simple. The **system design and operations** are what matter: Docker, CI/CD, testing, observability, autoscaling, and analysis of the results.
- This is a **one-time project**. The stack is built, tested once at 1M requests, results are captured, then everything is destroyed.
- There are no real users. Real-world completeness (emails, search, real payments) is not the point.
- **Success metric:** starting stock N = 10,000. Confirmed orders must equal exactly 10,000, stock must never go below 0, and there must be no duplicate orders.

## 2. Decisions made

| Decision | Reason |
|---|---|
| **Node.js (TypeScript)** | Async I/O suits a Redis-heavy `/buy` endpoint, and needs fewer pods for the same throughput |
| **Fastify 5 + ioredis 6** | Low overhead web framework, and a Redis client that supports Lua scripts |
| **Stock reserved by a Lua script, not a bare `DECR`** | A bare `DECR` briefly drives stock to -1. The script decrements only if stock > 0, so stock is never below 0 |
| **Region: ap-south-1 (Mumbai)** | Chosen at account setup. Use it for everything, including quota requests |
| **Public GitHub repo** | Free, unlimited Actions minutes, and works as a portfolio piece |
| **Queue: SQS first** | Managed, built-in dead-letter queue, nothing to run. ElasticMQ (SQS-compatible) in Docker Compose |
| **Queue behind a `Queue` interface** | `publish()` and `consume()` in `packages/shared`, so RabbitMQ can be swapped in later |
| **RabbitMQ later** | Optional experiment after the 1M proof |
| **Terraform CLI + S3 backend** | Free apart from pennies. HCP Terraform is not used (its free tier is being discontinued) |
| **SES removed** | No real users, so no emails are needed. Nothing in the load test depends on it |
| **Everything else kept** | Useful for showing the full architecture and operations |
| **Non-core services marked KEEP** | If one fights back, skip it using the fallback. The main goal still stands |
| **Own waiting room on Redis** | Cloudflare Waiting Room needs the Business plan ($200/month) and CrowdHandler Starter is $190/month. A custom queue is free and a better design showcase |
| **Run Redis in the cluster** | Free hosted Redis tiers are too small for the load test (see section 5) |
| **Fake payment service for now** | 50-150 ms delay, about 80% success. Razorpay test mode is a later KEEP item |
| **Local Compose runs infra only** | Redis, Postgres and ElasticMQ in Compose. API and worker run on the host until Phase 2 |

## 3. Services

CORE = the test fails or means nothing without it. KEEP = build it, but skip it if it causes trouble (fallback noted).

### Foundation
- CORE: Docker, Kubernetes with HPA, Terraform (S3 backend), VPC, IAM
- KEEP: Karpenter / Cluster Autoscaler (fallback: fixed node group sized for the test)
- KEEP: Secrets Manager (fallback: Kubernetes secrets)

### Edge and traffic
- CORE: ALB
- KEEP: Waiting room / virtual queue, built on Redis (fallback: plain rate limit)
- KEEP: WAF (allowlist the load generator during the test)
- KEEP: API Gateway (fallback: rate limit in the app or ALB)
- KEEP: CloudFront (fallback: test straight against the ALB)
- KEEP: Route 53 and ACM (fallback: use the ALB's own URL)

### Data
- CORE: Redis (atomic stock counter plus reservation TTL), run in-cluster *(built locally)*
- CORE: PostgreSQL / RDS (confirmed orders) *(built locally)*
- KEEP: PgBouncer / RDS Proxy (fallback: app-side pool)
- KEEP: OpenSearch (not on the buy path, fully skippable)
- KEEP: S3 (not needed for the test, apart from the Terraform state bucket)

### Async processing
- CORE: SQS (task queue) *(built locally with ElasticMQ)*
- CORE: Dead-letter queue *(built locally)*
- KEEP: Kafka / MSK (fallback: SQS only; needs the Paid plan)
- OPTIONAL: RabbitMQ experiment after the 1M proof

### Payments
- CORE: Idempotency keys on `/buy` *(built locally)*
- KEEP: Razorpay in test mode with webhooks (fallback: fake payment service that randomly succeeds or fails, **currently in use**)

### Delivery
- CORE: CI/CD (GitHub Actions), ECR
- KEEP: Helm (fallback: plain manifests)
- KEEP: Argo CD (fallback: deploy from CI)

### Observability
- CORE: Prometheus and Grafana
- KEEP: OpenTelemetry, Jaeger, Loki, Alertmanager

### Testing
- CORE: k6, run from inside AWS *(local k6 script built and passing)*

## 4. Core flow

1. User goes (Route 53 -> CloudFront/WAF, if kept) -> ALB -> backend pods.
2. Backend runs one atomic Redis Lua script: it checks the idempotency key, decrements stock **only if stock > 0**, and creates a reservation with a TTL.
3. A fake payment runs. If it fails, or the reservation expires, stock is returned to Redis exactly once (release is also atomic).
4. On success the order is pushed to SQS (and Kafka, if kept).
5. Workers write the confirmed order to PostgreSQL, then handle invoice and analytics. There is no email step. A unique constraint on the idempotency key makes duplicates harmless.

## 5. Free vs paid (non-AWS)

### Free (open source, no licence fee)
Kubernetes, Helm, Argo CD, Karpenter, Docker Engine and Compose, Redis, PostgreSQL, PgBouncer, RabbitMQ, Kafka, OpenSearch, Prometheus, Grafana, Loki, Jaeger, Alertmanager, OpenTelemetry, k6, ElasticMQ, and the Terraform CLI (OpenTofu is a free alternative). These still use compute on your nodes. Licences were not re-checked in detail.

### Free tier with limits
| Service | Free allowance | Catch |
|---|---|---|
| GitHub Actions | Free and unlimited on public repos. Student Pro gives private repos 3,000 minutes/month | This project uses a public repo |
| HCP Terraform | 500 managed resources, 1 concurrent run | Not used. S3 backend instead |
| Docker Hub | About 200 pulls per 6 hours when logged in | Push your own images to ECR |
| Grafana Cloud | 10,000 series, 50 GB each logs/traces/profiles, 14-day retention, 3 users | Optional. Self-hosting is the safe free route |
| Redis Cloud (free) | 30 MB, 30 connections | Too small for the load test |
| Upstash Redis (free) | 500K commands/month | About 8 minutes at 1,000 req/s with one `DECR` per request |
| Cloudflare Free | CDN, SSL, DNS, basic WAF, DDoS, IP rate limiting | Only 5 custom WAF rules; no Waiting Room |

### Paid
| Service | Cost |
|---|---|
| Razorpay | 2% + 18% GST (2.36% effective). 0% for the first 90 days, up to INR 5,00,000, for merchants activated on or after 1 July 2026 with no prior Razorpay history. Use test mode; confirm test mode is free |
| Stripe | 2% domestic, 3% international, but reported invite-only in India. Skip |
| Cloudflare Waiting Room | Business plan, $200/month. Skip |
| CrowdHandler | Starter $190/month. Skip |

## 6. AWS cost (paid from credits)

Confirmed in the console: **$200.00 USD in credits, expiring 19 May 2027**. Region: **ap-south-1 (Mumbai)**. Account plan: Free.

### Rates (US East, approximate)
These are US East rates. Mumbai prices have not been checked and may be slightly higher.

| Service | Cost |
|---|---|
| EKS control plane | $0.10/hour (about $73/month); worker nodes extra (cheapest about $30/month each) |
| NAT Gateway | $0.045/hour plus $0.045 per GB processed |
| ALB | $16.43/month plus $3.65/month per public IPv4 address |
| WAF | $5 per Web ACL, $1 per rule, $0.60 per million requests |
| RDS t4g.micro | About $12/month single-AZ, $23 Multi-AZ |
| OpenSearch (t3.small) | About $27/month. Serverless has a $350-700/month minimum; avoid |
| MSK | About $149 per broker minimum, about $447/month for 3 brokers. Needs the Paid account plan |
| Secrets Manager | $0.40 per secret per month; Parameter Store SecureString storage is free |
| API Gateway | HTTP API $1.00 per million requests; REST API $3.50 per million |

### Cost of the one-time run
Per-request charges are tiny, and the hourly cost of services existing is what matters. Estimated hourly cost with everything running (assuming about 5 small worker nodes, which is an assumption):

| Item | Per hour |
|---|---|
| EKS control plane | $0.10 |
| NAT Gateway | $0.045 |
| ALB | about $0.03 |
| RDS t4g.micro | about $0.016 |
| OpenSearch t3.small | about $0.036 |
| MSK, 3 brokers | about $0.61 |
| Worker nodes | about $0.20 |
| **Total** | **about $1.05/hour, about $25/day** |

A 48-hour window is about $50, and the 1M-request test itself adds only a few dollars. That fits the $200 budget with room for retries.

### AWS account rules
- The Free plan closes at 6 months or when credits run out. Joining AWS Organizations upgrades the account to Paid permanently, and credits then expire immediately, so do not do this.
- Credits expire 19 May 2027 (AWS's own FAQ gives both 6 and 12 months, so plan for the earlier).
- MSK is listed as a Paid-plan service. Upgrading through **Billing -> Upgrade plan** is safe because remaining credits carry over to future bills.
- On the Paid plan there is no automatic stop when credits run out, so keep the budget alert active.
- A $50 monthly cost budget alert is already set up.
- **EC2 vCPU quota:** the default in ap-south-1 is 5 vCPUs. A request for 32 has been submitted (pending). If it is denied or stalls, upgrade to Paid and request again.

## 7. Build and run plan

1. **Local first:** core on Docker Compose infra (Redis, Postgres, SQS emulator) with the app and worker on the host. Cost: $0. **Done.**
2. **Containers and CI/CD:** Dockerfiles, GitHub Actions, GHCR. Cost: $0. **Done.**
3. **Local Kubernetes:** Kubernetes, Helm and Argo CD on a local kind cluster. Cost: $0. **Done.**
4. **AWS smoke test:** bring the stack up with Terraform for a couple of hours, run 50-100k requests, fix problems, then destroy.
5. **Edge, security and payments:** add WAF, CloudFront, queue and payments as time allows.
6. **Observability:** Prometheus, Grafana, and the optional tracing, logging and alerting tools.
7. **Final run:** bring the stack up again, run k6 at 1M requests, prove no overselling, capture dashboards, then `terraform destroy`.
8. **Optional:** RabbitMQ experiment and write-up.

## 8. Checklist before the final run

- AWS budget alert set ($50, done).
- Allowlist the k6 load generator in WAF. A single IP sending 1M requests looks like an attack.
- Run k6 from inside AWS, on separate nodes or instances.
- Check service quotas (API Gateway throttling, EC2 vCPU limits for node scale-up).
- Run Redis in the cluster, not on a free hosted tier.
- After `terraform destroy`, confirm no NAT gateway, load balancer, EBS volume or MSK cluster is left, then delete the Terraform state bucket.

## 9. Not verified

- Pricing for ACM, Route 53, CloudFront, S3, ECR, SQS, RDS Proxy and CloudWatch was not checked. These are usually small, but check before relying on that.
- Mumbai (ap-south-1) prices were not checked. The rates above are US East.
- Whether Razorpay test mode is free was not confirmed.
- The about-5-worker-node count is an assumption.
- The EC2 vCPU quota increase (5 to 32) is pending.
- Prices are from third-party summaries of AWS pricing pages and may differ slightly from the live pages.
- Local results (about 4,170 requests/s on one laptop, with k6 and the app on the same machine) do not predict AWS throughput. Pod count, Redis and DB limits must be measured in Phases 4 and 7.

## 10. Sources

- Razorpay 0% offer: https://razorpay.com/blog/razorpay-0-percent-platform-fee-offer-90-days-new-merchants-2026/
- Razorpay pricing: https://razorpay.com/blog/?p=27922
- Stripe vs Razorpay: https://echai.ventures/explore/compare/stripe-vs-razorpay
- Grafana Cloud pricing: https://last9.io/blog/grafana-cloud-pricing/
- GitHub Actions pricing: https://cicdpipelinecost.com/github-actions-pricing
- GitHub plans (Pro: 3,000 Actions minutes): https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- HCP Terraform free tier: https://scalr.com/learning-center/hcp-terraform-free-tier-is-being-discontinued-what-you-need-to-know
- Redis Cloud pricing: https://redis.io/blog/new-pricing-for-redis-enterprise-cloud/
- Cheapest managed Redis: https://managed-db-pricing.pages.dev/blog/cheapest-managed-redis-2026/
- Cloudflare Waiting Room plans: https://developers.cloudflare.com/waiting-room/plans
- CrowdHandler vs Cloudflare: https://www.crowdhandler.com/blog/crowdhandler-vs-cloudflare-waiting-room-which-virtual-queue-solution-is-right-for-you
- AWS Free plan and credits: https://builder.aws.com/content/3Kkt4kNiDSUnO3n6db2weSNubzE/the-dollar0-aws-account-in-2026-free-plan-credits-guardrails
- AWS Free Tier FAQs (upgrade and credits): https://aws.amazon.com/free/faqs/
- AWS Free Plan supported services: https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.md
- EKS pricing: https://www.logicmonitor.com/blog/what-is-aws-eks-and-how-does-it-work-with-kubernetes
- NAT Gateway cost: https://www.opslyft.com/blog/aws-nat-gateway-cost
- ALB pricing: https://cloudburn.io/blog/aws-elastic-load-balancing-pricing
- AWS WAF pricing: https://www.wring.co/blog/aws-waf-pricing-guide
- RDS pricing: https://www.opslyft.com/blog/amazon-rds-pricing-explained
- OpenSearch pricing: https://coralogix.com/guides/opensearch/opensearch-pricing/
- MSK pricing: https://managed-db-pricing.pages.dev/db/msk-kafka/
- Secrets Manager pricing: https://cloudburn.io/blog/aws-secrets-manager-pricing
- API Gateway pricing: https://erpresearch.com/erp-add-ons/api-management/aws-api-gateway/pricing
