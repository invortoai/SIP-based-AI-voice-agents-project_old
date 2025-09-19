# Monitoring Exporters for PostgreSQL and Redis
# Provides detailed metrics collection for databases and caches

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# PostgreSQL Exporter
resource "aws_ecs_task_definition" "postgres_exporter" {
  count = var.enable_postgres_exporter ? 1 : 0

  family                   = "$${var.project_name}-postgres-exporter-${var.environment}"
  network_mode            = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                     = 256
  memory                  = 512
  execution_role_arn      = var.execution_role_arn
  task_role_arn           = var.task_role_arn

  container_definitions = jsonencode([
    {
      name  = "postgres-exporter"
      image = "quay.io/prometheuscommunity/postgres-exporter:v0.12.1"

      environment = [
        {
          name  = "DATA_SOURCE_NAME"
          value = "postgresql://$${var.db_username}:$${var.db_password}@$${var.db_endpoint}:5432/$${var.db_name}?sslmode=require"
        }
      ]

      portMappings = [
        {
          containerPort = 9187
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/$${var.project_name}-postgres-exporter-${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:9187/metrics || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "postgres_exporter" {
  count = var.enable_postgres_exporter ? 1 : 0

  name            = "$${var.project_name}-postgres-exporter"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.postgres_exporter[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnets
    security_groups  = [aws_security_group.postgres_exporter[0].id]
    assign_public_ip = false
  }

  depends_on = [
    aws_cloudwatch_log_group.postgres_exporter
  ]
}

resource "aws_security_group" "postgres_exporter" {
  count = var.enable_postgres_exporter ? 1 : 0

  name_prefix = "$${var.project_name}-postgres-exporter-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 9187
    to_port         = 9187
    protocol        = "tcp"
    security_groups = var.monitoring_security_groups
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "postgres_exporter" {
  count = var.enable_postgres_exporter ? 1 : 0

  name              = "/ecs/${var.project_name}-postgres-exporter-${var.environment}"
  retention_in_days = 30
}

# Redis Exporter
resource "aws_ecs_task_definition" "redis_exporter" {
  count = var.enable_redis_exporter ? 1 : 0

  family                   = "$${var.project_name}-redis-exporter-$${var.environment}"
  network_mode            = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                     = 256
  memory                  = 512
  execution_role_arn      = var.execution_role_arn
  task_role_arn           = var.task_role_arn

  container_definitions = jsonencode([
    {
      name  = "redis-exporter"
      image = "oliver006/redis_exporter:v1.54.0"

      environment = [
        {
          name  = "REDIS_ADDR"
          value = "redis://$${var.redis_endpoint}:6379"
        },
        {
          name  = "REDIS_PASSWORD"
          value = var.redis_password
        },
        {
          name  = "REDIS_EXPORTER_LOG_FORMAT"
          value = "json"
        }
      ]

      portMappings = [
        {
          containerPort = 9121
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/$${var.project_name}-redis-exporter-$${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:9121/metrics || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "redis_exporter" {
  count = var.enable_redis_exporter ? 1 : 0

  name            = "$${var.project_name}-redis-exporter"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.redis_exporter[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnets
    security_groups  = [aws_security_group.redis_exporter[0].id]
    assign_public_ip = false
  }

  depends_on = [
    aws_cloudwatch_log_group.redis_exporter
  ]
}

resource "aws_security_group" "redis_exporter" {
  count = var.enable_redis_exporter ? 1 : 0

  name_prefix = "$${var.project_name}-redis-exporter-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 9121
    to_port         = 9121
    protocol        = "tcp"
    security_groups = var.monitoring_security_groups
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "redis_exporter" {
  count = var.enable_redis_exporter ? 1 : 0

  name              = "/ecs/$${var.project_name}-redis-exporter-$${var.environment}"
  retention_in_days = 30
}

# Node Exporter for system metrics
resource "aws_ecs_task_definition" "node_exporter" {
  count = var.enable_node_exporter ? 1 : 0

  family                   = "$${var.project_name}-node-exporter-$${var.environment}"
  network_mode            = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                     = 256
  memory                  = 512
  execution_role_arn      = var.execution_role_arn
  task_role_arn           = var.task_role_arn

  container_definitions = jsonencode([
    {
      name  = "node-exporter"
      image = "prom/node-exporter:v1.6.1"

      portMappings = [
        {
          containerPort = 9100
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/$${var.project_name}-node-exporter-$${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:9100/metrics || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "node_exporter" {
  count = var.enable_node_exporter ? 1 : 0

  name            = "$${var.project_name}-node-exporter"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.node_exporter[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnets
    security_groups  = [aws_security_group.node_exporter[0].id]
    assign_public_ip = false
  }

  depends_on = [
    aws_cloudwatch_log_group.node_exporter
  ]
}

resource "aws_security_group" "node_exporter" {
  count = var.enable_node_exporter ? 1 : 0

  name_prefix = "$${var.project_name}-node-exporter-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 9100
    to_port         = 9100
    protocol        = "tcp"
    security_groups = var.monitoring_security_groups
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "node_exporter" {
  count = var.enable_node_exporter ? 1 : 0

  name              = "/ecs/$${var.project_name}-node-exporter-$${var.environment}"
  retention_in_days = 30
}

# Application Metrics Exporter (custom)
resource "aws_ecs_task_definition" "app_metrics_exporter" {
  count = var.enable_app_metrics_exporter ? 1 : 0

  family                   = "$${var.project_name}-app-metrics-exporter-$${var.environment}"
  network_mode            = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                     = 256
  memory                  = 512
  execution_role_arn      = var.execution_role_arn
  task_role_arn           = var.task_role_arn

  container_definitions = jsonencode([
    {
      name  = "app-metrics-exporter"
      image = "$${var.app_metrics_image}:$${var.app_metrics_tag}"

      environment = [
        {
          name  = "REDIS_URL"
          value = "redis://$${var.redis_endpoint}:6379"
        },
        {
          name  = "DB_URL"
          value = "postgresql://$${var.db_username}:$${var.db_password}@$${var.db_endpoint}:5432/$${var.db_name}"
        },
        {
          name  = "METRICS_PORT"
          value = "9090"
        }
      ]

      portMappings = [
        {
          containerPort = 9090
          protocol      = "tcp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/$${var.project_name}-app-metrics-exporter-$${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:9090/metrics || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "app_metrics_exporter" {
  count = var.enable_app_metrics_exporter ? 1 : 0

  name            = "$${var.project_name}-app-metrics-exporter"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.app_metrics_exporter[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnets
    security_groups  = [aws_security_group.app_metrics_exporter[0].id]
    assign_public_ip = false
  }

  depends_on = [
    aws_cloudwatch_log_group.app_metrics_exporter
  ]
}

resource "aws_security_group" "app_metrics_exporter" {
  count = var.enable_app_metrics_exporter ? 1 : 0

  name_prefix = "$${var.project_name}-app-metrics-exporter-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 9090
    to_port         = 9090
    protocol        = "tcp"
    security_groups = var.monitoring_security_groups
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "app_metrics_exporter" {
  count = var.enable_app_metrics_exporter ? 1 : 0

  name              = "/ecs/$${var.project_name}-app-metrics-exporter-$${var.environment}"
  retention_in_days = 30
}