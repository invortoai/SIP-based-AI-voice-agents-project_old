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

# === Application Target Groups (ALB) ===
resource "aws_lb_target_group" "api" {
  name        = "${var.environment}-api"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
  }

  tags = {
    Environment = var.environment
    Service     = "api"
  }
}

resource "aws_lb_target_group" "realtime" {
  name        = "${var.environment}-realtime"
  port        = 8081
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
  }

  tags = {
    Environment = var.environment
    Service     = "realtime"
  }
}

resource "aws_lb_target_group" "webhooks" {
  name        = "${var.environment}-webhooks"
  port        = 8082
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
  }

  tags = {
    Environment = var.environment
    Service     = "webhooks"
  }
}

# HTTPS listener on ALB with certificate
resource "aws_lb_listener" "https" {
  load_balancer_arn = module.alb.alb_arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# Route realtime paths to realtime TG
resource "aws_lb_listener_rule" "realtime" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.realtime.arn
  }

  condition {
    path_pattern {
      values = ["/realtime*", "/ws*", "/v1/realtime*"]
    }
  }
}

# Route API paths to API TG
resource "aws_lb_listener_rule" "api_paths" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/v1/*"]
    }
  }
}

# Route webhooks to webhooks TG
resource "aws_lb_listener_rule" "webhooks" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.webhooks.arn
  }

  condition {
    path_pattern {
      values = ["/webhooks*", "/hooks*"]
    }
  }
}

# === ECS Services using reusable ecs-service module ===

# API Service
module "svc_api" {
  source = "./modules/ecs-service"

  cluster_arn      = module.ecs_cluster.cluster_arn
  cluster_name     = module.ecs_cluster.cluster_name
  service_name     = "${var.environment}-api"
  container_name   = "api"
  container_port   = 8080
  image            = "${data.aws_ecr_repository.api.repository_url}:latest"
  cpu              = 512
  memory           = 1024
  subnets          = module.vpc.private_subnets
  security_groups  = [module.ecs_cluster.tasks_sg_id]
  target_group_arn = aws_lb_target_group.api.arn
  log_group        = module.ecs_cluster.log_group_api
  desired_count    = var.api_desired_count

  environment = {
    NODE_ENV  = "production"
    PORT      = "8080"
    REDIS_URL = "redis://${module.redis.endpoint}"
  }

  secrets = [
    { name = "SUPABASE_URL", valueFrom = module.secrets.secret_arns.supabase_url },
    { name = "SUPABASE_SERVICE_ROLE", valueFrom = module.secrets.secret_arns.supabase_service_role },
    { name = "OPENAI_API_KEY", valueFrom = module.secrets.secret_arns.openai },
    { name = "DEEPGRAM_API_KEY", valueFrom = module.secrets.secret_arns.deepgram },
    { name = "ELEVENLABS_API_KEY", valueFrom = module.secrets.secret_arns.elevenlabs },
    { name = "WEBHOOK_SECRET", valueFrom = module.secrets.secret_arns.webhook },
    { name = "JWT_PUBLIC_KEY", valueFrom = module.secrets.secret_arns.jwt }
  ]
}

# Realtime Service
module "svc_realtime" {
  source = "./modules/ecs-service"

  cluster_arn      = module.ecs_cluster.cluster_arn
  cluster_name     = module.ecs_cluster.cluster_name
  service_name     = "${var.environment}-realtime"
  container_name   = "realtime"
  container_port   = 8081
  image            = "${data.aws_ecr_repository.realtime.repository_url}:latest"
  cpu              = 512
  memory           = 1024
  subnets          = module.vpc.private_subnets
  security_groups  = [module.ecs_cluster.tasks_sg_id]
  target_group_arn = aws_lb_target_group.realtime.arn
  log_group        = module.ecs_cluster.log_group_realtime
  desired_count    = var.realtime_desired_count

  environment = {
    NODE_ENV  = "production"
    PORT      = "8081"
    REDIS_URL = "redis://${module.redis.endpoint}"
  }

  secrets = [
    { name = "SUPABASE_URL", valueFrom = module.secrets.secret_arns.supabase_url },
    { name = "SUPABASE_SERVICE_ROLE", valueFrom = module.secrets.secret_arns.supabase_service_role },
    { name = "OPENAI_API_KEY", valueFrom = module.secrets.secret_arns.openai },
    { name = "DEEPGRAM_API_KEY", valueFrom = module.secrets.secret_arns.deepgram },
    { name = "WEBHOOK_SECRET", valueFrom = module.secrets.secret_arns.webhook },
    { name = "JWT_PUBLIC_KEY", valueFrom = module.secrets.secret_arns.jwt }
  ]
}

# Webhooks Service
module "svc_webhooks" {
  source = "./modules/ecs-service"

  cluster_arn      = module.ecs_cluster.cluster_arn
  cluster_name     = module.ecs_cluster.cluster_name
  service_name     = "${var.environment}-webhooks"
  container_name   = "webhooks"
  container_port   = 8082
  image            = "${data.aws_ecr_repository.webhooks.repository_url}:latest"
  cpu              = 256
  memory           = 512
  subnets          = module.vpc.private_subnets
  security_groups  = [module.ecs_cluster.tasks_sg_id]
  target_group_arn = aws_lb_target_group.webhooks.arn
  log_group        = module.ecs_cluster.log_group_webhooks
  desired_count    = var.webhooks_desired_count

  environment = {
    NODE_ENV  = "production"
    PORT      = "8082"
    REDIS_URL = "redis://${module.redis.endpoint}"
  }

  secrets = [
    { name = "SUPABASE_URL", valueFrom = module.secrets.secret_arns.supabase_url },
    { name = "SUPABASE_SERVICE_ROLE", valueFrom = module.secrets.secret_arns.supabase_service_role },
    { name = "OPENAI_API_KEY", valueFrom = module.secrets.secret_arns.openai },
    { name = "DEEPGRAM_API_KEY", valueFrom = module.secrets.secret_arns.deepgram },
    { name = "WEBHOOK_SECRET", valueFrom = module.secrets.secret_arns.webhook },
    { name = "JWT_PUBLIC_KEY", valueFrom = module.secrets.secret_arns.jwt }
  ]
}

# Workers Service (no load balancer)
module "svc_workers" {
  source = "./modules/ecs-service"

  cluster_arn          = module.ecs_cluster.cluster_arn
  cluster_name         = module.ecs_cluster.cluster_name
  service_name         = "${var.environment}-workers"
  container_name       = "workers"
  container_port       = 8083
  image                = "${data.aws_ecr_repository.workers.repository_url}:latest"
  cpu                  = 256
  memory               = 512
  subnets              = module.vpc.private_subnets
  security_groups      = [module.ecs_cluster.tasks_sg_id]
  enable_load_balancer = false
  log_group            = module.ecs_cluster.log_group_workers
  desired_count        = var.workers_desired_count

  environment = {
    NODE_ENV  = "production"
    PORT      = "8083"
    REDIS_URL = "redis://${module.redis.endpoint}"
  }

  secrets = [
    { name = "SUPABASE_URL", valueFrom = module.secrets.secret_arns.supabase_url },
    { name = "SUPABASE_SERVICE_ROLE", valueFrom = module.secrets.secret_arns.supabase_service_role },
    { name = "OPENAI_API_KEY", valueFrom = module.secrets.secret_arns.openai },
    { name = "DEEPGRAM_API_KEY", valueFrom = module.secrets.secret_arns.deepgram },
    { name = "WEBHOOK_SECRET", valueFrom = module.secrets.secret_arns.webhook },
    { name = "JWT_PUBLIC_KEY", valueFrom = module.secrets.secret_arns.jwt }
  ]
}

# Telephony Service (internal, no ALB)
module "svc_telephony" {
  source = "./modules/ecs-service"

  cluster_arn          = module.ecs_cluster.cluster_arn
  cluster_name         = module.ecs_cluster.cluster_name
  service_name         = "${var.environment}-telephony-ecs"
  container_name       = "telephony"
  container_port       = 8085
  image                = "${data.aws_ecr_repository.api.repository_url}:latest" # adjust if separate ECR for telephony exists
  cpu                  = 256
  memory               = 512
  subnets              = module.vpc.private_subnets
  security_groups      = [module.ecs_cluster.tasks_sg_id]
  enable_load_balancer = false
  log_group            = "/ecs/${var.environment}/telephony"
  desired_count        = var.telephony_desired_count

  environment = {
    NODE_ENV  = "production"
    PORT      = "8085"
    REDIS_URL = "redis://${module.redis.endpoint}"
  }

  secrets = [
    { name = "SUPABASE_URL", valueFrom = module.secrets.secret_arns.supabase_url },
    { name = "SUPABASE_SERVICE_ROLE", valueFrom = module.secrets.secret_arns.supabase_service_role },
    { name = "OPENAI_API_KEY", valueFrom = module.secrets.secret_arns.openai },
    { name = "DEEPGRAM_API_KEY", valueFrom = module.secrets.secret_arns.deepgram },
    { name = "WEBHOOK_SECRET", valueFrom = module.secrets.secret_arns.webhook },
    { name = "JWT_PUBLIC_KEY", valueFrom = module.secrets.secret_arns.jwt }
  ]
}
