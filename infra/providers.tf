provider "aws" {
  region = var.region

  # Safety net: refuse to run against any other AWS account.
  allowed_account_ids = ["474874559122"]

  default_tags {
    tags = {
      Project   = "flash-sale"
      ManagedBy = "terraform"
    }
  }
}