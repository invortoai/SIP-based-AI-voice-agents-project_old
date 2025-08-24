# Variables for Cost Management Module

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for cost management resources"
  type        = string
}

variable "monthly_budget_amount" {
  description = "Monthly budget amount in USD"
  type        = number
  default     = 1000
}

variable "daily_budget_amount" {
  description = "Daily budget amount in USD"
  type        = number
  default     = 50
}

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

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
