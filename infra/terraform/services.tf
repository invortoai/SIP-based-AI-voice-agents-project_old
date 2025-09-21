# ECS Service for Telephony - Temporarily disabled due to missing dependencies
# resource "aws_ecs_service" "telephony" {
#   name            = "${var.environment}-telephony"
#   cluster         = module.ecs_cluster.cluster_id
#   task_definition = aws_ecs_task_definition.telephony.arn
#   desired_count   = var.telephony_desired_count

#   network_configuration {
#     subnets         = module.vpc.private_subnets
#     security_groups = [aws_security_group.telephony.id]
#   }

#   load_balancer {
#     target_group_arn = aws_lb_target_group.telephony.arn
#     container_name   = "telephony"
#     container_port   = 8085
#   }

#   depends_on = [aws_lb_listener.telephony]

#   tags = {
#     Name        = "${var.environment}-telephony-service"
#     Environment = var.environment
#     Service     = "telephony"
#   }
# }

# # resource "aws_ecs_task_definition" "telephony" {
# #   family                   = "${var.environment}-telephony"
# #   network_mode             = "awsvpc"
# #   requires_compatibilities = ["FARGATE"]
# #   cpu                      = var.telephony_cpu
# #   memory                   = var.telephony_memory
# #   execution_role_arn       = aws_iam_role.ecs_execution.arn
# #   task_role_arn            = aws_iam_role.telephony_task_role.arn

# #   container_definitions = jsonencode([
# #     {
# #       name  = "telephony"
# #       image = "${aws_ecr_repository.telephony.repository_url}:latest"

# #       portMappings = [
# #         {
# #           containerPort = 8085
# #           hostPort      = 8085
# #           protocol      = "tcp"
# #         }
# #       ]

# #       environment = [
# #         { name = "NODE_ENV", value = "production" },
# #         { name = "PORT", value = "8085" },
# #         {
# #           name  = "REDIS_URL"
# #           value = "redis://${module.redis.endpoint}:6379"
# #         },
# #         {
# #           name  = "PUBLIC_BASE_URL"
# #           value = "https://${var.domain}"
# #         },
# #         {
# #           name  = "REALTIME_WS_URL"
# #           value = "wss://${var.domain}/v1/realtime"
# #         },
# #         { name = "CALL_TIMEOUT_MINUTES", value = "30" },
# #         { name = "CLEANUP_INTERVAL_MINUTES", value = "5" },
# #         { name = "CIRCUIT_BREAKER_FAILURE_THRESHOLD", value = "5" },
# #         { name = "CIRCUIT_BREAKER_TIMEOUT_MS", value = "60000" }
# #       ]

# #       secrets = [
# #         {
# #           name      = "TELEPHONY_SHARED_SECRET"
# #           valueFrom = "${module.secrets.telephony_secret_arn}:TELEPHONY_SHARED_SECRET::"
# #         },
# #         {
# #           name      = "JAMBONZ_WEBHOOK_SECRET"
# #           valueFrom = "${module.secrets.jambonz_secret_arn}:JAMBONZ_WEBHOOK_SECRET::"
# #         },
# #         {
# #           name      = "ALLOWED_JAMBONZ_IPS"
# #           valueFrom = "${module.secrets.telephony_secret_arn}:ALLOWED_JAMBONZ_IPS::"
# #         }
# #       ]

# #       logConfiguration = {
# #         logDriver = "awslogs"
# #         options = {
# #           awslogs-group         = "/ecs/${var.environment}/telephony"
# #           awslogs-region        = var.aws_region
# #           awslogs-stream-prefix = "ecs"
# #         }
# #       }

# #       healthCheck = {
# #         command  = ["CMD-SHELL", "curl -f http://localhost:8085/health || exit 1"]
# #         interval = 30
# #         timeout  = 5
# #         retries  = 3
# #       }
# #     }
# #   ])

# #   tags = {
# #     Environment = var.environment
# #     Service     = "telephony"
# #   }
# # }

# ECR Repositories for Docker images - Using existing repositories
data "aws_ecr_repository" "api" {
  name = "invorto-api"
}

data "aws_ecr_repository" "realtime" {
  name = "invorto-realtime"
}

data "aws_ecr_repository" "workers" {
  name = "invorto-workers"
}

data "aws_ecr_repository" "webhooks" {
  name = "invorto-webhooks"
}

# ECR Repository for Telephony - Temporarily disabled due to configuration issues
# resource "aws_ecr_repository" "telephony" {
#   name                 = "${var.environment}-telephony"
#   image_tag_mutability = "MUTABLE"

#   image_scanning_configuration {
#     scan_on_push = true
#   }

#   tags = {
#     Environment = var.environment
#     Service     = "telephony"
#   }
# }

# # Security Group for Telephony - Temporarily disabled due to missing ALB security group
# resource "aws_security_group" "telephony" {
#   name_prefix = "${var.environment}-telephony-"
#   vpc_id      = module.vpc.vpc_id

#   ingress {
#     from_port       = 8085
#     to_port         = 8085
#     protocol        = "tcp"
#     security_groups = [aws_security_group.alb.id]
#   }

#   egress {
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     cidr_blocks = ["0.0.0.0/0"]
#   }

#   tags = {
#     Name        = "${var.environment}-telephony-sg"
#     Environment = var.environment
#     Service     = "telephony"
#   }
# }

# # ALB Target Group for Telephony - Temporarily disabled due to configuration issues
# resource "aws_lb_target_group" "telephony" {
#   name        = "${var.environment}-telephony"
#   port        = 8085
#   protocol    = "HTTP"
#   vpc_id      = module.vpc.vpc_id
#   target_type = "ip"

#   health_check {
#     enabled             = true
#     healthy_threshold   = 2
#     unhealthy_threshold = 2
#     timeout             = 5
#     interval            = 30
#     path                = "/health"
#     matcher             = "200"
#   }

#   tags = {
#     Environment = var.environment
#     Service     = "telephony"
#   }
# }

# # ALB Listener for Telephony - Temporarily disabled due to configuration issues
# resource "aws_lb_listener" "telephony" {
#   load_balancer_arn = module.alb.alb_arn
#   port              = "443"
#   protocol          = "HTTPS"
#   ssl_policy        = "ELBSecurityPolicy-2016-08"
#   certificate_arn   = var.certificate_arn

#   default_action {
#     type             = "forward"
#     target_group_arn = aws_lb_target_group.telephony.arn
#   }
# }

# # CloudWatch Log Group - Temporarily disabled due to configuration issues
# resource "aws_cloudwatch_log_group" "telephony" {
#   name              = "/ecs/${var.environment}/telephony"
#   retention_in_days = 30

#   tags = {
#     Environment = var.environment
#     Service     = "telephony"
#   }
# }
