# IAM for the AWS Load Balancer Controller (installed with Helm after the cluster is up).
# It reuses the pods_assume trust policy from iam.tf and Pod Identity, like the app role.

resource "aws_iam_policy" "alb_controller" {
  name   = "${var.name}-alb-controller"
  policy = file("${path.module}/alb_iam_policy.json")
}

resource "aws_iam_role" "alb_controller" {
  name               = "${var.name}-alb-controller"
  assume_role_policy = data.aws_iam_policy_document.pods_assume.json
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

resource "aws_eks_pod_identity_association" "alb_controller" {
  cluster_name    = module.eks.cluster_name
  namespace       = "kube-system"
  service_account = "aws-load-balancer-controller"
  role_arn        = aws_iam_role.alb_controller.arn
}