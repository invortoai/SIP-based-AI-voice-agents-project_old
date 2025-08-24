# Variables for CI/CD Pipeline Module

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for CI/CD resources"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster for deployment"
  type        = string
  default     = "invorto-cluster"
}

variable "github_connection_arn" {
  description = "ARN of the GitHub connection for CodePipeline"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in format owner/repo"
  type        = string
  default     = "invorto/voice-ai-platform"
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

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
