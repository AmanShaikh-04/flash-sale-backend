variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "name" {
  type    = string
  default = "flash-sale"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "kubernetes_version" {
  type    = string
  default = "1.36"
}

variable "node_instance_type" {
  type    = string
  default = "c5.large" # 2 vCPUs
}

variable "app_node_count" {
  type    = number
  default = 1
}

variable "loadgen_node_count" {
  type    = number
  default = 1
}