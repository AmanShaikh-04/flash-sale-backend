resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = module.vpc.private_subnets
}

# Only the EKS nodes may reach the database.
resource "aws_security_group" "rds" {
  name_prefix = "${var.name}-rds-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_db_instance" "orders" {
  identifier        = "${var.name}-orders"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = "flashsale"
  username = "flash"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # Throwaway database: no backups or snapshots, so destroy is clean.
  backup_retention_period = 0
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true
}