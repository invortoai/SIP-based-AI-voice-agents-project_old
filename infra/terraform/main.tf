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
  source = "../modules/vpc"
  
  environment = var.environment
  vpc_cidr   = var.vpc_cidr
  azs        = var.availability_zones
}

# ECS Cluster for Realtime WS + API + Webhooks + Workers
module "ecs_cluster" {
  source = "../modules/ecs-cluster"
  
  environment     = var.environment
  vpc_id         = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets
  public_subnets  = module.vpc.public_subnets
}

# Jambonz Media Gateway (EC2 ASG)
module "jambonz_media" {
  source = "../modules/jambonz-media"
  
  environment     = var.environment
  vpc_id         = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets
  target_group_arns = [] # Will be updated when ALB target groups are created
  instance_type   = var.jambonz_instance_type
  ami_id          = var.jambonz_ami_id
  key_name        = var.jambonz_key_name
  desired_capacity = var.jambonz_desired_capacity
  min_size        = var.jambonz_min_size
  max_size        = var.jambonz_max_size
  root_volume_size = var.jambonz_root_volume_size
  domain          = var.jambonz_domain
  redis_url       = "redis://${module.redis.endpoint}:6379"
  db_url          = "postgresql://${var.db_username}:${var.db_password}@${module.rds.endpoint}:5432/${var.db_name}"
  secrets_arn     = module.secrets.jambonz_secret_arn
  sip_allowed_cidrs = var.jambonz_sip_allowed_cidrs
  admin_allowed_cidrs = var.jambonz_admin_allowed_cidrs
  tags            = {
    Service = "jambonz-media"
    Component = "telephony"
  }
}

# Application Load Balancer (WS upgrade + WAF)
module "alb" {
  source = "../modules/alb"
  
  environment     = var.environment
  vpc_id         = module.vpc.vpc_id
  public_subnets = module.vpc.public_subnets
  certificate_arn = var.certificate_arn
}

# Redis ElastiCache
module "redis" {
  source = "../modules/redis"
  
  environment     = var.environment
  vpc_id         = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets
  node_type       = var.redis_node_type
}

# S3 Buckets for recordings, transcripts, metrics
module "s3" {
  source = "../modules/s3"
  
  environment = var.environment
  bucket_prefix = "invorto"
}

# Secrets Manager for provider keys, HMAC, JWT
module "secrets" {
  source = "../modules/secrets"
  
  environment = var.environment
}

# WAF rules (rate-limit, IP allowlists)
module "waf" {
  source = "../modules/waf"
  
  environment = var.environment
}

# CloudWatch alarms and dashboards
module "monitoring" {
  source = "../modules/monitoring"
  
  environment = var.environment
  aws_region = var.aws_region
  monthly_budget = var.monthly_budget
  enable_email_alerts = var.enable_email_alerts
  alert_email = var.alert_email
  enable_slack_alerts = var.enable_slack_alerts
  slack_webhook_url = var.slack_webhook_url
  tags = {
    Service = "monitoring"
    Component = "observability"
  }
}

# CI/CD Pipeline Infrastructure
module "ci_cd" {
  source = "../modules/ci-cd"
  
  environment = var.environment
  aws_region = var.aws_region
  ecs_cluster_name = module.ecs_cluster.cluster_name
  github_connection_arn = var.github_connection_arn
  github_repository = var.github_repository
  github_branch = var.github_branch
  enable_pipeline_notifications = var.enable_pipeline_notifications
  pipeline_notification_email = var.pipeline_notification_email
  tags = {
    Service = "ci-cd"
    Component = "deployment"
  }
}

# Backup and Disaster Recovery
module "backup_dr" {
  source = "../modules/backup-dr"
  
  environment = var.environment
  aws_region = var.aws_region
  enable_cross_region_backup = var.enable_cross_region_backup
  enable_backup_vault_lock = var.enable_backup_vault_lock
  backup_vault_lock_days = var.backup_vault_lock_days
  daily_backup_retention_days = var.db_backup_retention_days
  weekly_backup_retention_days = var.db_weekly_backup_retention_days
  monthly_backup_retention_days = var.db_monthly_backup_retention_days
  backup_alarm_actions = [module.monitoring.alerts_topic_arn]
  tags = {
    Service = "backup-dr"
    Component = "resilience"
  }
}

# Cost Management and Budget Controls
module "cost_management" {
  source = "../modules/cost-management"
  
  environment = var.environment
  aws_region = var.aws_region
  monthly_budget_amount = var.monthly_budget
  daily_budget_amount = var.daily_cost_limit
  monthly_usage_limit = var.monthly_usage_limit
  daily_cost_threshold = var.daily_cost_threshold
  budget_notification_emails = var.budget_notification_emails
  enable_cost_email_alerts = var.enable_cost_email_alerts
  cost_alert_email = var.cost_alert_email
  enable_cost_slack_alerts = var.enable_cost_slack_alerts
  cost_slack_webhook_url = var.cost_slack_webhook_url
  enable_cost_explorer_reports = var.enable_cost_explorer_reports
  cost_allocation_tags = var.cost_allocation_tags
  tags = {
    Service = "cost-management"
    Component = "governance"
  }
}
