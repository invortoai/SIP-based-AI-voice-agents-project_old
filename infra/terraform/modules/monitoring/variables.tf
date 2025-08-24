# Variables for Monitoring and Observability Module

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for monitoring resources"
  type        = string
}

variable "monthly_budget" {
  description = "Monthly budget threshold for cost alerts"
  type        = number
  default     = 1000
}

variable "enable_email_alerts" {
  description = "Enable email alerts via SNS"
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Email address for alerts"
  type        = string
  default     = ""
}

variable "enable_slack_alerts" {
  description = "Enable Slack alerts via SNS"
  type        = bool
  default     = false
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for alerts"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
