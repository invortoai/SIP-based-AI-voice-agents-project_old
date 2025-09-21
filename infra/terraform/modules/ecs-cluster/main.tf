# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = var.environment == "production" ? "production-invorto-cluster" : "${var.environment}-invorto-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = "${var.environment}-invorto-ecs-cluster"
    Environment = var.environment
  }
}

# ECS Task Execution Role
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.environment}-invorto-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ECS Task Role
resource "aws_iam_role" "ecs_task_role" {
  name = "${var.environment}-invorto-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Security Groups
resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${var.environment}-invorto-ecs-"
  vpc_id      = var.vpc_id

  ingress {
    protocol    = "tcp"
    from_port   = 8080
    to_port     = 8085
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-invorto-ecs-sg"
    Environment = var.environment
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "realtime" {
  name              = "/ecs/${var.environment}-invorto-realtime"
  retention_in_days = 7

  tags = {
    Environment = var.environment
    Service     = "realtime"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}-invorto-api"
  retention_in_days = 7

  tags = {
    Environment = var.environment
    Service     = "api"
  }
}

resource "aws_cloudwatch_log_group" "webhooks" {
  name              = "/ecs/${var.environment}-invorto-webhooks"
  retention_in_days = 7

  tags = {
    Environment = var.environment
    Service     = "webhooks"
  }
}

resource "aws_cloudwatch_log_group" "workers" {
  name              = "/ecs/${var.environment}-invorto-workers"
  retention_in_days = 7

  tags = {
    Environment = var.environment
    Service     = "workers"
  }
}
