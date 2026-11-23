locals {
  repos = ["flash-sale-api", "flash-sale-worker"]
}

resource "aws_ecr_repository" "app" {
  for_each             = toset(local.repos)
  name                 = each.key
  image_tag_mutability = "MUTABLE"
  force_delete         = true # lets terraform destroy remove the repo even if it holds images

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}