# Variables for Backup and Disaster Recovery Module

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for backup resources"
  type        = string
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

variable "daily_backup_retention_days" {
  description = "Number of days to retain daily backups"
  type        = number
  default     = 30
}

variable "weekly_backup_retention_days" {
  description = "Number of days to retain weekly backups"
  type        = number
  default     = 90
}

variable "monthly_backup_retention_days" {
  description = "Number of days to retain monthly backups"
  type        = number
  default     = 365
}

variable "backup_alarm_actions" {
  description = "List of ARNs for backup alarm actions (SNS topics, etc.)"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
