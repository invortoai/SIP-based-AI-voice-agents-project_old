# Outputs for Cost Management Module

output "monthly_budget_name" {
  description = "Name of the monthly budget"
  value       = aws_budgets_budget.monthly.name
}

output "monthly_budget_arn" {
  description = "ARN of the monthly budget"
  value       = aws_budgets_budget.monthly.arn
}

output "daily_budget_name" {
  description = "Name of the daily budget"
  value       = aws_budgets_budget.daily.name
}

output "daily_budget_arn" {
  description = "ARN of the daily budget"
  value       = aws_budgets_budget.daily.arn
}

output "usage_budget_name" {
  description = "Name of the usage budget"
  value       = aws_budgets_budget.usage.name
}

output "usage_budget_arn" {
  description = "ARN of the usage budget"
  value       = aws_budgets_budget.usage.arn
}

output "cost_alerts_topic_arn" {
  description = "ARN of the SNS topic for cost alerts"
  value       = aws_sns_topic.cost_alerts.arn
}

output "cost_alerts_topic_name" {
  description = "Name of the SNS topic for cost alerts"
  value       = aws_sns_topic.cost_alerts.name
}

output "cost_dashboard_name" {
  description = "Name of the CloudWatch dashboard for cost monitoring"
  value       = aws_cloudwatch_dashboard.cost.dashboard_name
}

output "cost_threshold_alarm_arn" {
  description = "ARN of the CloudWatch alarm for cost threshold"
  value       = aws_cloudwatch_metric_alarm.cost_threshold.arn
}

output "high_cpu_cost_alarm_arn" {
  description = "ARN of the CloudWatch alarm for high CPU cost"
  value       = aws_cloudwatch_metric_alarm.high_cpu_cost.arn
}

output "high_memory_cost_alarm_arn" {
  description = "ARN of the CloudWatch alarm for high memory cost"
  value       = aws_cloudwatch_metric_alarm.high_memory_cost.arn
}

output "unused_resources_alarm_arn" {
  description = "ARN of the CloudWatch alarm for unused resources"
  value       = aws_cloudwatch_metric_alarm.unused_resources.arn
}

output "cost_reports_bucket_name" {
  description = "Name of the S3 bucket for cost reports"
  value       = var.enable_cost_explorer_reports ? aws_s3_bucket.cost_reports[0].bucket : null
}

output "cost_reports_bucket_arn" {
  description = "ARN of the S3 bucket for cost reports"
  value       = var.enable_cost_explorer_reports ? aws_s3_bucket.cost_reports[0].arn : null
}

output "cost_explorer_role_arn" {
  description = "ARN of the IAM role for Cost Explorer"
  value       = var.enable_cost_explorer_reports ? aws_iam_role.cost_explorer[0].arn : null
}

output "cost_management_log_group_name" {
  description = "Name of the CloudWatch log group for cost management"
  value       = aws_cloudwatch_log_group.cost_management.name
}
