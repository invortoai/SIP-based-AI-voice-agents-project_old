terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "invorto-terraform-state"
    key    = "prod/terraform.tfstate"
    region = "ap-south-1"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "invorto-voice-ai"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Provider for Disaster Recovery region
provider "aws" {
  alias  = "dr_region"
  region = var.dr_region

  default_tags {
    tags = {
      Project     = "invorto-voice-ai"
      Environment = var.environment
      ManagedBy   = "terraform"
      Purpose     = "disaster-recovery"
    }
  }
}

# VPC and Networking
module "vpc" {
  source = "./modules/vpc"

  environment = var.environment
  vpc_cidr    = var.vpc_cidr
  azs         = var.availability_zones
}

# ECS Cluster for Realtime WS + API + Webhooks + Workers
module "ecs_cluster" {
  source = "./modules/ecs-cluster"
}

# Jambonz Media Gateway (EC2 ASG)
module "jambonz_media" {
  source = "./modules/jambonz-media"

  environment         = var.environment
  vpc_id              = module.vpc.vpc_id
  private_subnets     = module.vpc.private_subnets
  target_group_arns   = [] # Will be updated when ALB target groups are created
  instance_type       = var.jambonz_instance_type
  ami_id              = var.jambonz_ami_id
  key_name            = var.jambonz_key_name
  desired_capacity    = var.jambonz_desired_capacity
  min_size            = var.jambonz_min_size
  max_size            = var.jambonz_max_size
  root_volume_size    = var.jambonz_root_volume_size
  domain              = var.jambonz_domain
  redis_url           = "redis://$${module.redis.endpoint}:6379"
  db_url              = "postgresql://$${var.db_username}:$${var.db_password}@$${aws_db_instance.main.endpoint}:5432/$${var.db_name}"
  secrets_arn         = module.secrets.jambonz_secret_arn
  sip_allowed_cidrs   = var.jambonz_sip_allowed_cidrs
  admin_allowed_cidrs = var.jambonz_admin_allowed_cidrs
  tags = {
    Service   = "jambonz-media"
    Component = "telephony"
  }
}

# Application Load Balancer (WS upgrade + WAF)
module "alb" {
  source = "./modules/alb"

  environment     = var.environment
  vpc_id          = module.vpc.vpc_id
  public_subnets  = module.vpc.public_subnets
  certificate_arn = var.certificate_arn
}

# Redis ElastiCache
module "redis" {
  source = "./modules/redis"

  environment     = var.environment
  vpc_id          = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets
  node_type       = var.redis_node_type
}

# S3 Buckets for recordings, transcripts, metrics
module "s3" {
  source = "./modules/s3"

  environment   = var.environment
  bucket_prefix = "invorto"
}

# Telephony Service S3 Bucket for call recordings and logs
resource "aws_s3_bucket" "telephony_data" {
  bucket = "$${var.environment}-invorto-telephony-data"

  tags = {
    Name        = "$${var.environment}-invorto-telephony-data"
    Environment = var.environment
    Service     = "telephony"
    Purpose     = "call-recordings-logs"
  }
}

resource "aws_s3_bucket_versioning" "telephony_data" {
  bucket = aws_s3_bucket.telephony_data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "telephony_data" {
  bucket = aws_s3_bucket.telephony_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "telephony_data" {
  bucket = aws_s3_bucket.telephony_data.id

  rule {
    id     = "call_recordings_lifecycle"
    status = "Enabled"

    filter {
      prefix = "recordings/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }

  rule {
    id     = "logs_lifecycle"
    status = "Enabled"

    filter {
      prefix = "logs/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 90
    }
  }
}

# IAM Role for Telephony Service
resource "aws_iam_role" "telephony_task_role" {
  name = "$${var.environment}-telephony-task-role"

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

  tags = {
    Environment = var.environment
    Service     = "telephony"
  }
}

resource "aws_iam_role_policy" "telephony_task_policy" {
  name = "$${var.environment}-telephony-task-policy"
  role = aws_iam_role.telephony_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.telephony_data.arn,
          "$${aws_s3_bucket.telephony_data.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:ListMetrics"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Secrets Manager for provider keys, HMAC, JWT
module "secrets" {
  source = "./modules/secrets"

  environment = var.environment
}

# WAF rules (rate-limit, IP allowlists) - Temporarily disabled due to configuration issues
# module "waf" {
#   source = "./modules/waf"
#
#   project_name               = var.project_name
#   environment                = var.environment
#   aws_region                 = var.aws_region
#   alb_arn                    = module.alb.alb_arn
#   rate_limit                 = var.waf_rate_limit
#   allowed_countries          = var.waf_allowed_countries
#   blocked_countries          = var.waf_blocked_countries
#   allowed_ip_addresses       = var.waf_allowed_ip_addresses
#   blocked_ip_addresses       = var.waf_blocked_ip_addresses
#   blocked_requests_threshold = var.waf_blocked_requests_threshold
#   alarm_sns_topic_arn        = module.monitoring.alerts_topic_arn
#   enable_logging             = var.waf_enable_logging
#   log_bucket_arn             = module.s3.logs_bucket_arn
# }

# CloudWatch alarms and dashboards
module "monitoring" {
  source = "./modules/monitoring"

  environment         = var.environment
  aws_region          = var.aws_region
  monthly_budget      = var.monthly_budget
  enable_email_alerts = var.enable_email_alerts
  alert_email         = var.alert_email
  enable_slack_alerts = var.enable_slack_alerts
  slack_webhook_url   = var.slack_webhook_url
  tags = {
    Service   = "monitoring"
    Component = "observability"
  }
}

# CI/CD Pipeline Infrastructure - Temporarily disabled due to configuration issues
# module "ci_cd" {
#   source = "./modules/ci-cd"
#
#   environment                   = var.environment
#   aws_region                    = var.aws_region
#   ecs_cluster_name              = module.ecs_cluster.cluster_name
#   github_connection_arn         = var.github_connection_arn
#   github_repository             = var.github_repository
#   github_branch                 = var.github_branch
#   enable_pipeline_notifications = var.enable_pipeline_notifications
#   pipeline_notification_email   = var.pipeline_notification_email
#   tags = {
#     Service   = "ci-cd"
#     Component = "deployment"
#   }
# }

# Backup and Disaster Recovery - Temporarily disabled due to provider configuration issues
# module "backup_dr" {
#   source = "./modules/backup-dr"
#
#   environment                   = var.environment
#   aws_region                    = var.aws_region
#   enable_cross_region_backup    = false # Disabled to avoid provider configuration issues
#   enable_backup_vault_lock      = var.enable_backup_vault_lock
#   backup_vault_lock_days        = var.backup_vault_lock_days
#   daily_backup_retention_days   = var.db_backup_retention_days
#   weekly_backup_retention_days  = var.db_weekly_backup_retention_days
#   monthly_backup_retention_days = var.db_monthly_backup_retention_days
#   backup_alarm_actions          = [module.monitoring.alerts_topic_arn]
#   tags = {
#     Service   = "backup-dr"
#     Component = "resilience"
#   }
# }

# Cost Management and Budget Controls - Temporarily disabled due to configuration issues
# module "cost_management" {
#   source = "./modules/cost-management"
#
#   environment                  = var.environment
#   aws_region                   = var.aws_region
#   monthly_budget_amount        = var.monthly_budget
#   daily_budget_amount          = var.daily_cost_limit
#   monthly_usage_limit          = var.monthly_usage_limit
#   daily_cost_threshold         = var.daily_cost_threshold
#   budget_notification_emails   = var.budget_notification_emails
#   enable_cost_email_alerts     = var.enable_cost_email_alerts
#   cost_alert_email             = var.cost_alert_email
#   enable_cost_slack_alerts     = var.enable_cost_slack_alerts
#   cost_slack_webhook_url       = var.cost_slack_webhook_url
#   enable_cost_explorer_reports = var.enable_cost_explorer_reports
#   cost_allocation_tags         = var.cost_allocation_tags
#   tags = {
#     Service   = "cost-management"
#     Component = "governance"
#   }
# }

# Service Mesh (Istio) - Temporarily disabled due to configuration issues
# module "service_mesh" {
#   source = "./modules/service-mesh"
#
#   cluster_name        = module.ecs_cluster.cluster_name
#   enable_istio        = var.enable_service_mesh
#   istio_version       = var.istio_version
#   enable_kiali        = var.enable_kiali
#   enable_jaeger       = var.enable_jaeger
#   enable_prometheus   = var.enable_prometheus
#   ssl_certificate_arn = var.ssl_certificate_arn
#   jwt_issuer          = var.jwt_issuer
#   jwks_uri            = var.jwks_uri
#   jwt_audience        = var.jwt_audience
#
#   tags = {
#     Service   = "service-mesh"
#     Component = "istio"
#   }
# }

# Monitoring Exporters (PostgreSQL, Redis, Node, Application metrics) - Temporarily disabled due to configuration issues
# module "monitoring_exporters" {
#   source = "./modules/monitoring-exporters"
#
#   project_name               = var.project_name
#   environment                = var.environment
#   aws_region                 = var.aws_region
#   vpc_id                     = module.vpc.vpc_id
#   private_subnets            = module.vpc.private_subnets
#   ecs_cluster_id             = module.ecs_cluster.cluster_id
#   execution_role_arn         = aws_iam_role.telephony_task_role.arn
#   task_role_arn              = aws_iam_role.telephony_task_role.arn
#   monitoring_security_groups = []
#
#   # PostgreSQL
#   enable_postgres_exporter = var.enable_postgres_exporter
#   db_endpoint              = ""
#   db_username              = var.db_username
#   db_password              = var.db_password
#   db_name                  = var.db_name
#
#   # Redis
#   enable_redis_exporter = var.enable_redis_exporter
#   redis_endpoint        = module.redis.endpoint
#   redis_password        = var.redis_password
#
#   # Node Exporter
#   enable_node_exporter = var.enable_node_exporter
#
#   # Application Metrics
#   enable_app_metrics_exporter = var.enable_app_metrics_exporter
#   app_metrics_image           = var.app_metrics_image
#   app_metrics_tag             = var.app_metrics_tag
#
#   tags = {
#     Service   = "monitoring-exporters"
#     Component = "observability"
#   }
# }
