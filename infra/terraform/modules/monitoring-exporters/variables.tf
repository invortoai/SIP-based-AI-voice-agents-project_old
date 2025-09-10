variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "invorto"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnets" {
  description = "Private subnet IDs"
  type        = list(string)
}

variable "ecs_cluster_id" {
  description = "ECS cluster ID"
  type        = string
}

variable "execution_role_arn" {
  description = "ECS execution role ARN"
  type        = string
}

variable "task_role_arn" {
  description = "ECS task role ARN"
  type        = string
}

variable "monitoring_security_groups" {
  description = "Security groups allowed to access monitoring endpoints"
  type        = list(string)
  default     = []
}

# PostgreSQL Exporter
variable "enable_postgres_exporter" {
  description = "Enable PostgreSQL metrics exporter"
  type        = bool
  default     = true
}

variable "db_endpoint" {
  description = "PostgreSQL database endpoint"
  type        = string
}

variable "db_username" {
  description = "PostgreSQL database username"
  type        = string
}

variable "db_password" {
  description = "PostgreSQL database password"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "invorto"
}

# Redis Exporter
variable "enable_redis_exporter" {
  description = "Enable Redis metrics exporter"
  type        = bool
  default     = true
}

variable "redis_endpoint" {
  description = "Redis cluster endpoint"
  type        = string
}

variable "redis_password" {
  description = "Redis password"
  type        = string
  sensitive   = true
  default     = ""
}

# Node Exporter
variable "enable_node_exporter" {
  description = "Enable Node.js application metrics exporter"
  type        = bool
  default     = true
}

# Application Metrics Exporter
variable "enable_app_metrics_exporter" {
  description = "Enable custom application metrics exporter"
  type        = bool
  default     = true
}

variable "app_metrics_image" {
  description = "Docker image for application metrics exporter"
  type        = string
  default     = "invorto/app-metrics-exporter"
}

variable "app_metrics_tag" {
  description = "Docker image tag for application metrics exporter"
  type        = string
  default     = "latest"
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}