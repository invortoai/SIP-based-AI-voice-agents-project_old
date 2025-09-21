variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnets" { type = list(string) }
variable "node_type" { type = string }

resource "aws_security_group" "redis" {
  name_prefix = "${var.environment}-redis-"
  vpc_id      = var.vpc_id

  ingress {
    protocol    = "tcp"
    from_port   = 6379
    to_port     = 6379
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.environment}-invorto-redis-subnets"
  subnet_ids = var.private_subnets
}

resource "aws_elasticache_cluster" "this" {
  cluster_id           = "${var.environment}-invorto-redis"
  engine               = "redis"
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  port                 = 6379
  security_group_ids   = [aws_security_group.redis.id]
}

output "endpoint" {
  value = "${aws_elasticache_cluster.this.cache_nodes[0].address}:6379"
}
