terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Backend blocks cannot use variables. The AWS profile comes from $env:AWS_PROFILE.
  backend "s3" {
    bucket       = "flash-sale-tfstate-474874559122"
    key          = "flash-sale/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true # S3-native locking, no DynamoDB table needed
  }
}