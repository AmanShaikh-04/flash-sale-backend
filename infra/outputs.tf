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