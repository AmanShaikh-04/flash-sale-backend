# Pods that run as this ServiceAccount get the SQS permissions below.
# The Helm chart will create the ServiceAccount in Step 9.
variable "app_namespace" {
  type    = string
  default = "default"
}

variable "app_service_account" {
  type    = string
  default = "flash-sale"
}

data "aws_iam_policy_document" "pods_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app_pods" {
  name               = "${var.name}-app-pods"
  assume_role_policy = data.aws_iam_policy_document.pods_assume.json
}

# Only the two queues, only the actions the api, worker, seed and verify need.
data "aws_iam_policy_document" "sqs_access" {
  statement {
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
      "sqs:PurgeQueue",
    ]
    resources = [
      aws_sqs_queue.orders.arn,
      aws_sqs_queue.orders_dlq.arn,
    ]
  }
}

resource "aws_iam_role_policy" "app_pods_sqs" {
  name   = "sqs-access"
  role   = aws_iam_role.app_pods.id
  policy = data.aws_iam_policy_document.sqs_access.json
}

resource "aws_eks_pod_identity_association" "app" {
  cluster_name    = module.eks.cluster_name
  namespace       = var.app_namespace
  service_account = var.app_service_account
  role_arn        = aws_iam_role.app_pods.arn
}