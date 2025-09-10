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

variable "alb_arn" {
  description = "ARN of the ALB to associate with WAF"
  type        = string
}

variable "rate_limit" {
  description = "Rate limit for requests per 5-minute period"
  type        = number
  default     = 2000
}

variable "allowed_countries" {
  description = "List of allowed country codes (ISO 3166-1 alpha-2)"
  type        = list(string)
  default     = ["US", "IN", "GB", "CA", "AU", "DE", "FR", "JP", "SG", "NL"]
}

variable "blocked_countries" {
  description = "List of blocked country codes"
  type        = list(string)
  default     = []
}

variable "allowed_ip_addresses" {
  description = "List of allowed IP addresses/CIDRs"
  type        = list(string)
  default     = []
}

variable "blocked_ip_addresses" {
  description = "List of blocked IP addresses/CIDRs"
  type        = list(string)
  default     = []
}

variable "bad_bot_user_agents" {
  description = "Bad bot user agent strings to block"
  type        = list(string)
  default     = [
    "bot",
    "crawler",
    "spider",
    "scanner",
    "scraper",
    "python-requests",
    "curl",
    "wget"
  ]
}

variable "blocked_requests_threshold" {
  description = "Threshold for blocked requests CloudWatch alarm"
  type        = number
  default     = 100
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for WAF alarms"
  type        = string
  default     = ""
}

variable "enable_logging" {
  description = "Enable WAF logging to S3"
  type        = bool
  default     = true
}

variable "log_bucket_arn" {
  description = "S3 bucket ARN for WAF logs"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}