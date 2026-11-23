module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name               = var.name
  kubernetes_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  endpoint_public_access                   = true
  enable_cluster_creator_admin_permissions = true # gives your root login kubectl admin rights

  addons = {
    vpc-cni                = { before_compute = true }
    eks-pod-identity-agent = { before_compute = true }
    kube-proxy             = {}
    coredns                = {}
  }

  eks_managed_node_groups = {
    app = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = [var.node_instance_type]
      min_size       = var.app_node_count
      max_size       = var.app_node_count
      desired_size   = var.app_node_count
      labels         = { role = "app" }
    }

    loadgen = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = [var.node_instance_type]
      min_size       = var.loadgen_node_count
      max_size       = var.loadgen_node_count
      desired_size   = var.loadgen_node_count
      labels         = { role = "loadgen" }
      taints = {
        loadgen = {
          key    = "role"
          value  = "loadgen"
          effect = "NO_SCHEDULE" # only pods that tolerate this (k6) land here
        }
      }
    }
  }
}