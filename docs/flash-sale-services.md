# Flash-Sale Ticket / Sneaker Drop: Final Service List

**Language:** Node.js (TypeScript) | **Region:** ap-south-1 (Mumbai) | **Starting stock:** N = 10,000

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
- Redis (atomic stock counter + reservation TTL, runs in-cluster)
- PostgreSQL / RDS (confirmed orders)
- PgBouncer / RDS Proxy (connection pooling)
- OpenSearch (typo-tolerant catalog search)
- S3 (product images, and the Terraform state bucket)

## Async Processing
- **SQS** (task queue, chosen first; ElasticMQ or LocalStack locally)
- Dead-letter queue (failed messages)
- Kafka / MSK (events, analytics, optional)
- RabbitMQ (later experiment after the 1M proof, behind the same queue interface)

## Payments
- Razorpay or Stripe (with webhooks)
- Idempotency keys on `/buy` (no duplicate orders)

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
- k6 (load test)

> SES (emails) was removed. There are no real users, so no emails are needed.

---

## Core Flow
1. User -> Route 53 -> CloudFront/WAF -> ALB -> backend pods
2. Backend runs atomic Redis `DECR` on stock; rejects if below 0
3. Redis holds a reservation with TTL; stock is released if payment fails
4. Order is pushed to SQS (and Kafka, if kept)
5. Workers write the confirmed order to PostgreSQL, then handle invoice and analytics (no email step)

## Build Order
1. Core locally with Docker Compose (app, Redis, Postgres, SQS emulator)
2. Kubernetes + Helm + Argo CD
3. Terraform + cloud services
4. Edge, security and payments
5. Observability
6. k6 load test to prove no overselling
7. Optional: RabbitMQ experiment and write-up
