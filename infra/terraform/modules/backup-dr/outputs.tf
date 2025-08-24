# Outputs for Backup and Disaster Recovery Module

output "backup_vault_name" {
  description = "Name of the main backup vault"
  value       = aws_backup_vault.main.name
}

output "backup_vault_arn" {
  description = "ARN of the main backup vault"
  value       = aws_backup_vault.main.arn
}

output "backup_plan_name" {
  description = "Name of the backup plan"
  value       = aws_backup_plan.main.name
}

output "backup_plan_arn" {
  description = "ARN of the backup plan"
  value       = aws_backup_plan.main.arn
}

output "dr_backup_vault_name" {
  description = "Name of the disaster recovery backup vault"
  value       = var.enable_cross_region_backup ? aws_backup_vault.dr[0].name : null
}

output "dr_backup_vault_arn" {
  description = "ARN of the disaster recovery backup vault"
  value       = var.enable_cross_region_backup ? aws_backup_vault.dr[0].arn : null
}

output "application_backup_bucket_name" {
  description = "Name of the S3 bucket for application data backup"
  value       = aws_s3_bucket.application_backup.bucket
}

output "application_backup_bucket_arn" {
  description = "ARN of the S3 bucket for application data backup"
  value       = aws_s3_bucket.application_backup.arn
}

output "config_backup_bucket_name" {
  description = "Name of the S3 bucket for configuration backup"
  value       = aws_s3_bucket.config_backup.bucket
}

output "config_backup_bucket_arn" {
  description = "ARN of the S3 bucket for configuration backup"
  value       = aws_s3_bucket.config_backup.arn
}

output "dr_application_backup_bucket_name" {
  description = "Name of the cross-region S3 bucket for application data backup"
  value       = var.enable_cross_region_backup ? aws_s3_bucket.dr_application_backup[0].bucket : null
}

output "dr_application_backup_bucket_arn" {
  description = "ARN of the cross-region S3 bucket for application data backup"
  value       = var.enable_cross_region_backup ? aws_s3_bucket.dr_application_backup[0].arn : null
}

output "backup_role_arn" {
  description = "ARN of the IAM role for AWS Backup"
  value       = aws_iam_role.backup.arn
}

output "replication_role_arn" {
  description = "ARN of the IAM role for S3 replication"
  value       = var.enable_cross_region_backup ? aws_iam_role.replication[0].arn : null
}

output "backup_log_group_name" {
  description = "Name of the CloudWatch log group for backup operations"
  value       = aws_cloudwatch_log_group.backup.name
}

output "backup_dashboard_name" {
  description = "Name of the CloudWatch dashboard for backup monitoring"
  value       = aws_cloudwatch_dashboard.backup.dashboard_name
}

output "backup_failures_alarm_arn" {
  description = "ARN of the CloudWatch alarm for backup failures"
  value       = aws_cloudwatch_metric_alarm.backup_failures.arn
}

output "recovery_points_alarm_arn" {
  description = "ARN of the CloudWatch alarm for recovery points"
  value       = aws_cloudwatch_metric_alarm.recovery_points.arn
}
