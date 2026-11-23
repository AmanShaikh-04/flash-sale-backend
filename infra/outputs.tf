output "vpc_id" {
  value = module.vpc.vpc_id
}

output "private_subnet_ids" {
  value = module.vpc.private_subnets
}

output "public_subnet_ids" {
  value = module.vpc.public_subnets
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "orders_queue_url" {
  value = aws_sqs_queue.orders.url
}

output "orders_queue_arn" {
  value = aws_sqs_queue.orders.arn
}

output "orders_dlq_arn" {
  value = aws_sqs_queue.orders_dlq.arn
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "rds_address" {
  value = aws_db_instance.orders.address
}

# RDS Postgres 16 requires SSL. sslmode=no-verify makes the worker's pg client use it.
output "database_url" {
  value     = "postgres://flash:${random_password.db.result}@${aws_db_instance.orders.address}:5432/flashsale?sslmode=no-verify"
  sensitive = true
}
