variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "invorto"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "api.invortoai.com"
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "invorto"
}

variable "db_username" {
  description = "Username for the database"
  type        = string
  default     = "invorto_admin"
}

variable "db_instance_class" {
  description = "Instance class for RDS"
  type        = string
  default     = "db.t3.micro"
}

variable "redis_node_type" {
  description = "Node type for Redis cluster"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache nodes for Redis"
  type        = number
  default     = 1
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
  default     = "invorto-cluster"
}

variable "enable_container_insights" {
  description = "Enable Container Insights for ECS cluster"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default = {
    Project     = "Invorto"
    ManagedBy   = "Terraform"
    Environment = "production"
  }
}

# Service-specific variables
variable "api_desired_count" {
  description = "Desired count for API service"
  type        = number
  default     = 2
}

variable "api_min_count" {
  description = "Minimum count for API service"
  type        = number
  default     = 1
}

variable "api_max_count" {
  description = "Maximum count for API service"
  type        = number
  default     = 10
}

variable "realtime_desired_count" {
  description = "Desired count for Realtime service"
  type        = number
  default     = 3
}

variable "realtime_min_count" {
  description = "Minimum count for Realtime service"
  type        = number
  default     = 2
}

variable "realtime_max_count" {
  description = "Maximum count for Realtime service"
  type        = number
  default     = 20
}

variable "webhooks_desired_count" {
  description = "Desired count for Webhooks service"
  type        = number
  default     = 2
}

variable "webhooks_min_count" {
  description = "Minimum count for Webhooks service"
  type        = number
  default     = 1
}

variable "webhooks_max_count" {
  description = "Maximum count for Webhooks service"
  type        = number
  default     = 5
}

variable "workers_desired_count" {
  description = "Desired count for Workers service"
  type        = number
  default     = 2
}

variable "workers_min_count" {
  description = "Minimum count for Workers service"
  type        = number
  default     = 1
}

variable "workers_max_count" {
  description = "Maximum count for Workers service"
  type        = number
  default     = 10
}

# Monitoring and Alerting
variable "enable_monitoring" {
  description = "Enable CloudWatch monitoring"
  type        = bool
  default     = true
}

variable "enable_alerting" {
  description = "Enable CloudWatch alerting"
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Email address for alerts"
  type        = string
  default     = ""
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for notifications"
  type        = string
  default     = ""
  sensitive   = true
}

# Cost Management
variable "enable_cost_alerts" {
  description = "Enable cost alerts"
  type        = bool
  default     = true
}

variable "monthly_budget" {
  description = "Monthly budget in USD"
  type        = number
  default     = 1000
}

# Security
variable "enable_waf" {
  description = "Enable AWS WAF"
  type        = bool
  default     = true
}

variable "enable_guardduty" {
  description = "Enable AWS GuardDuty"
  type        = bool
  default     = true
}

variable "enable_security_hub" {
  description = "Enable AWS Security Hub"
  type        = bool
  default     = false
}

# Backup
variable "enable_backup" {
  description = "Enable AWS Backup"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "Backup retention in days"
  type        = number
  default     = 30
}

# API Keys (to be stored in Secrets Manager)
variable "deepgram_api_key" {
  description = "Deepgram API key"
  type        = string
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

variable "webhook_secret" {
  description = "Webhook secret for HMAC verification"
  type        = string
  sensitive   = true
}

# Backup Policy Variables
variable "db_backup_retention_days" {
  description = "Number of days to retain database backups"
  type        = number
  default     = 30
}

variable "db_weekly_backup_retention_days" {
  description = "Number of days to retain weekly database backups"
  type        = number
  default     = 90
}

variable "db_monthly_backup_retention_days" {
  description = "Number of days to retain monthly database backups"
  type        = number
  default     = 365
}

# Budget Alert Variables
variable "daily_cost_limit" {
  description = "Daily cost limit per tenant in INR"
  type        = number
  default     = 10000
}

# Jambonz Media Gateway Variables
variable "jambonz_instance_type" {
  description = "EC2 instance type for Jambonz media gateway"
  type        = string
  default     = "c5.2xlarge"
}

variable "jambonz_min_size" {
  description = "Minimum number of Jambonz instances"
  type        = number
  default     = 1
}

variable "jambonz_max_size" {
  description = "Maximum number of Jambonz instances"
  type        = number
  default     = 5
}

variable "jambonz_desired_capacity" {
  description = "Desired number of Jambonz instances"
  type        = number
  default     = 2
}

variable "jambonz_ami_id" {
  description = "AMI ID for Jambonz instances (leave empty to auto-resolve latest Ubuntu 22.04 in-region)"
  type        = string
  default     = ""
}

variable "jambonz_key_name" {
  description = "SSH key pair name for Jambonz instances"
  type        = string
}

variable "jambonz_root_volume_size" {
  description = "Root volume size for Jambonz instances in GB"
  type        = number
  default     = 100
}

variable "jambonz_domain" {
  description = "Domain name for Jambonz configuration"
  type        = string
  default     = "telephony.invorto.ai"
}

variable "jambonz_sip_allowed_cidrs" {
  description = "CIDR blocks allowed for SIP traffic"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Restrict this in production
}

variable "jambonz_admin_allowed_cidrs" {
  description = "CIDR blocks allowed for admin access"
  type        = list(string)
  default     = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
}

# CI/CD Pipeline Variables
variable "github_connection_arn" {
  description = "ARN of the GitHub connection for CodePipeline"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in format owner/repo"
  type        = string
  default     = "invortoai/SIP-based-AI-voice-agents-project_old"
}

variable "github_branch" {
  description = "GitHub branch to deploy from"
  type        = string
  default     = "main"
}

variable "enable_pipeline_notifications" {
  description = "Enable pipeline notifications via SNS"
  type        = bool
  default     = true
}

variable "pipeline_notification_email" {
  description = "Email address for pipeline notifications"
  type        = string
  default     = ""
}

# Backup and Disaster Recovery Variables
variable "dr_region" {
  description = "AWS region for disaster recovery resources"
  type        = string
  default     = "ap-south-2"
}

variable "enable_cross_region_backup" {
  description = "Enable cross-region backup for disaster recovery"
  type        = bool
  default     = true
}

variable "enable_backup_vault_lock" {
  description = "Enable backup vault lock to prevent deletion"
  type        = bool
  default     = false
}

variable "backup_vault_lock_days" {
  description = "Number of days to lock backup vault after creation"
  type        = number
  default     = 7
}

# Cost Management Variables
variable "monthly_usage_limit" {
  description = "Monthly usage limit in GB-months"
  type        = number
  default     = 1000
}

variable "daily_cost_threshold" {
  description = "Daily cost threshold for alarms in USD"
  type        = number
  default     = 100
}

variable "budget_notification_emails" {
  description = "List of email addresses for budget notifications"
  type        = list(string)
  default     = []
}

variable "enable_cost_email_alerts" {
  description = "Enable email alerts for cost management"
  type        = bool
  default     = true
}

variable "cost_alert_email" {
  description = "Email address for cost alerts"
  type        = string
  default     = ""
}

variable "enable_cost_slack_alerts" {
  description = "Enable Slack alerts for cost management"
  type        = bool
  default     = false
}

variable "cost_slack_webhook_url" {
  description = "Slack webhook URL for cost alerts"
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_cost_explorer_reports" {
  description = "Enable AWS Cost Explorer reports"
  type        = bool
  default     = true
}

variable "cost_allocation_tags" {
  description = "Map of cost allocation tags"
  type        = map(string)
  default = {
    Environment = "production"
    Project     = "invorto-voice-ai"
    Service     = "platform"
    Component   = "infrastructure"
    Owner       = "devops"
    CostCenter  = "engineering"
  }
}

# Monitoring Variables
variable "enable_email_alerts" {
  description = "Enable email alerts via SNS"
  type        = bool
  default     = false
}


variable "enable_slack_alerts" {
  description = "Enable Slack alerts via SNS"
  type        = bool
  default     = false
}


# Telephony Service Variables
variable "telephony_desired_count" {
  description = "Desired number of telephony service tasks"
  type        = number
  default     = 2
}

variable "telephony_cpu" {
  description = "CPU units for telephony service (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "telephony_memory" {
  description = "Memory for telephony service in MB"
  type        = number
  default     = 1024
}

variable "domain" {
  description = "Domain name for the application"
  type        = string
  default     = "api.invortoai.com"
}

# Missing variables that modules are expecting
variable "certificate_arn" {
  description = "ARN of the SSL certificate for ALB"
  type        = string
}

variable "db_password" {
  description = "Password for the database"
  type        = string
  sensitive   = true
}

# WAF Variables
variable "waf_rate_limit" {
  description = "Rate limit for WAF"
  type        = number
  default     = 2000
}

variable "waf_allowed_countries" {
  description = "List of allowed country codes for WAF"
  type        = list(string)
  default     = ["US", "IN", "GB", "CA", "AU"]
}

variable "waf_blocked_countries" {
  description = "List of blocked country codes for WAF"
  type        = list(string)
  default     = []
}

variable "waf_allowed_ip_addresses" {
  description = "List of allowed IP addresses for WAF"
  type        = list(string)
  default     = []
}

variable "waf_blocked_ip_addresses" {
  description = "List of blocked IP addresses for WAF"
  type        = list(string)
  default     = []
}

variable "waf_blocked_requests_threshold" {
  description = "Threshold for blocked requests alarm"
  type        = number
  default     = 100
}

variable "waf_enable_logging" {
  description = "Enable WAF logging"
  type        = bool
  default     = true
}

# Service Mesh Variables
variable "enable_service_mesh" {
  description = "Enable service mesh (Istio)"
  type        = bool
  default     = false
}

variable "istio_version" {
  description = "Istio version to install"
  type        = string
  default     = "1.19.0"
}

variable "enable_kiali" {
  description = "Enable Kiali dashboard"
  type        = bool
  default     = false
}

variable "enable_jaeger" {
  description = "Enable Jaeger tracing"
  type        = bool
  default     = false
}

variable "enable_prometheus" {
  description = "Enable Prometheus monitoring"
  type        = bool
  default     = false
}

variable "ssl_certificate_arn" {
  description = "SSL certificate ARN for service mesh"
  type        = string
  default     = ""
}

variable "jwt_issuer" {
  description = "JWT issuer for service mesh"
  type        = string
  default     = ""
}

variable "jwks_uri" {
  description = "JWKS URI for service mesh"
  type        = string
  default     = ""
}

variable "jwt_audience" {
  description = "JWT audience for service mesh"
  type        = string
  default     = ""
}

# Monitoring Exporters Variables
variable "enable_postgres_exporter" {
  description = "Enable PostgreSQL exporter"
  type        = bool
  default     = false
}

variable "enable_redis_exporter" {
  description = "Enable Redis exporter"
  type        = bool
  default     = false
}

variable "enable_node_exporter" {
  description = "Enable Node exporter"
  type        = bool
  default     = false
}

variable "enable_app_metrics_exporter" {
  description = "Enable application metrics exporter"
  type        = bool
  default     = false
}

variable "app_metrics_image" {
  description = "Docker image for app metrics exporter"
  type        = string
  default     = "prom/node-exporter"
}

variable "app_metrics_tag" {
  description = "Docker tag for app metrics exporter"
  type        = string
  default     = "latest"
}

variable "redis_password" {
  description = "Redis password"
  type        = string
  sensitive   = true
}
