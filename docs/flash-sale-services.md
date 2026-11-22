# Flash-Sale Ticket / Sneaker Drop: Final Service List

Last updated: 22 Nov 2026

**Language:** Node.js (TypeScript) | **Region:** ap-south-1 (Mumbai) | **Starting stock:** N = 10,000

## Build status (22 Nov 2026)

**Built and verified locally (Phase 1):** Redis (atomic Lua stock, reservations, idempotency), PostgreSQL (orders), SQS API via ElasticMQ, dead-letter queue, idempotency keys, fake payment service, worker, k6 load test, verification script. Docker Compose runs Redis, Postgres and ElasticMQ.

**Built and verified (Phase 2):** Docker images for the api and worker, GitHub Actions (check, smoke, publish), images on GHCR.

**Built and verified (Phase 3):** Kubernetes on kind, a Helm chart (api, worker, Redis, Postgres, ElasticMQ, HPA, Secret), metrics-server, Argo CD deploying from `main`.

**Next (Phase 4):** Terraform, EKS, RDS, SQS, ECR and the AWS smoke test.

**Not started:** everything else (Terraform, AWS services, edge layers, observability).

## Foundation
- Terraform CLI with an S3 backend (IaC, no HCP Terraform)
- Docker (packaging)
- Kubernetes with HPA (pod autoscaling)
- Karpenter / Cluster Autoscaler (node autoscaling)
- VPC (private networking)
- IAM (least-privilege access)
- Secrets Manager (credentials)

## Edge & Traffic
- Route 53 (DNS)
- CloudFront (CDN)
- WAF (bot and attack protection)
- ALB (load balancer)
- API Gateway (rate limiting)
- ACM (HTTPS certificates)
- Waiting room / virtual queue (fair entry, built on Redis)

## Data
- Redis (atomic stock counter + reservation TTL, runs in-cluster) *(built locally)*
- PostgreSQL / RDS (confirmed orders) *(built locally)*
- PgBouncer / RDS Proxy (connection pooling)
- OpenSearch (typo-tolerant catalog search)
- S3 (product images, and the Terraform state bucket)

## Async Processing
- **SQS** (task queue, chosen first; ElasticMQ locally) *(built locally)*
- Dead-letter queue (failed messages) *(built locally)*
- Kafka / MSK (events, analytics, optional)
- RabbitMQ (later experiment after the 1M proof, behind the same queue interface)

## Payments
- Razorpay or Stripe (with webhooks)
- Fake payment service (80% success), the fallback, currently in use *(built locally)*
- Idempotency keys on `/buy` (no duplicate orders) *(built locally)*

## Delivery
- CI/CD (GitHub Actions, public repo)
- ECR (image registry)
- Helm (K8s packaging)
- Argo CD (GitOps deploys)

## Observability
- OpenTelemetry (instrumentation)
- Prometheus (metrics)
- Grafana (dashboards)
- Jaeger (tracing)
- Loki (logs)
- Alertmanager (alerts)

## Testing
- k6 (load test) *(built locally)*
- `seed.ts` and `verify.ts` (reset and check the success metric) *(built locally)*

> SES (emails) was removed. There are no real users, so no emails are needed.

---

## Core Flow
1. User -> Route 53 -> CloudFront/WAF -> ALB -> backend pods
2. Backend runs one atomic Redis Lua script: checks the idempotency key, decrements stock **only if stock > 0** (never a bare `DECR`), and creates a reservation with a TTL
3. Fake payment runs. If it fails, or the reservation expires, stock is returned to Redis exactly once
4. On success the order is pushed to SQS (and Kafka, if kept)
5. Workers write the confirmed order to PostgreSQL (`ON CONFLICT DO NOTHING`), then handle invoice and analytics (no email step)

## Build Order
1. Core locally with Docker Compose (app, Redis, Postgres, SQS emulator) **(done)**
2. Docker images and CI/CD **(done)**
3. Kubernetes + Helm + Argo CD **(done)**
4. Terraform + cloud services
5. Edge, security and payments
6. Observability
7. k6 load test to prove no overselling
8. Optional: RabbitMQ experiment and write-up
