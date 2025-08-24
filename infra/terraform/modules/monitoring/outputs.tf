# Outputs for Monitoring and Observability Module

output "alerts_topic_arn" {
  description = "ARN of the SNS alerts topic"
  value       = aws_sns_topic.alerts.arn
}

output "alerts_topic_name" {
  description = "Name of the SNS alerts topic"
  value       = aws_sns_topic.alerts.name
}

output "infrastructure_dashboard_name" {
  description = "Name of the infrastructure CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.infrastructure.dashboard_name
}

output "application_dashboard_name" {
  description = "Name of the application CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.application.dashboard_name
}

output "security_dashboard_name" {
  description = "Name of the security CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.security.dashboard_name
}

output "application_log_group_name" {
  description = "Name of the application CloudWatch log group"
  value       = aws_cloudwatch_log_group.application.name
}

output "access_log_group_name" {
  description = "Name of the access CloudWatch log group"
  value       = aws_cloudwatch_log_group.access.name
}

output "error_log_group_name" {
  description = "Name of the error CloudWatch log group"
  value       = aws_cloudwatch_log_group.error.name
}

output "high_cpu_alarm_arn" {
  description = "ARN of the high CPU alarm"
  value       = aws_cloudwatch_metric_alarm.high_cpu.arn
}

output "high_memory_alarm_arn" {
  description = "ARN of the high memory alarm"
  value       = aws_cloudwatch_metric_alarm.high_memory.arn
}

output "high_error_rate_alarm_arn" {
  description = "ARN of the high error rate alarm"
  value       = aws_cloudwatch_metric_alarm.high_error_rate.arn
}

output "high_response_time_alarm_arn" {
  description = "ARN of the high response time alarm"
  value       = aws_cloudwatch_metric_alarm.high_response_time.arn
}

output "redis_connections_alarm_arn" {
  description = "ARN of the Redis connections alarm"
  value       = aws_cloudwatch_metric_alarm.redis_connections.arn
}

output "db_connections_alarm_arn" {
  description = "ARN of the database connections alarm"
  value       = aws_cloudwatch_metric_alarm.db_connections.arn
}

output "jambonz_health_alarm_arn" {
  description = "ARN of the Jambonz health alarm"
  value       = aws_cloudwatch_metric_alarm.jambonz_health.arn
}

output "cost_threshold_alarm_arn" {
  description = "ARN of the cost threshold alarm"
  value       = aws_cloudwatch_metric_alarm.cost_threshold.arn
}
