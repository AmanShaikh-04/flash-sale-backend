# Decisions

Last updated: 19 Nov 2026

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
| Local queue | ElasticMQ or LocalStack (SQS-compatible) in Docker Compose | Same code works locally and on AWS |
| Queue code | Behind a small interface | Makes the later RabbitMQ swap easy |
| RabbitMQ | **Later**, as an optional experiment after the 1M proof | Explore it without risking the main goal |
| IaC | Terraform CLI | Core requirement |
| Terraform state | **S3 backend** (no HCP Terraform) | Free apart from pennies, and HCP's free tier is being discontinued |
| State bucket | Created once, kept across `terraform destroy`, deleted at the very end | Keeps `destroy` reliable |
| Redis | In-cluster | Free hosted tiers are too small |
| Waiting room | Own build on Redis | Paid options cost $190-200/month |
| SES | Removed | No real users, no emails needed |

## Success metric
- Starting stock **N = 10,000**.
- Confirmed orders must equal exactly **10,000**.
- Stock must never go below 0.
- No duplicate orders (idempotency keys hold).
- DLQ empty or fully explained.

## Service quotas
- EC2 "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z)" in ap-south-1: default **5 vCPUs**.
- **Requested 32 vCPUs.** Status: pending (check Service Quotas -> Quota request history).
- If denied or stalled for a day or two: upgrade to Paid plan (Billing -> Upgrade plan) and request again.
- Still to check later: API Gateway throttling limits.
