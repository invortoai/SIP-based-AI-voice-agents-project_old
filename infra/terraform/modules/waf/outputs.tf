output "web_acl_arn" {
  description = "ARN of the WAF Web ACL"
  value       = aws_wafv2_web_acl.main.arn
}

output "web_acl_id" {
  description = "ID of the WAF Web ACL"
  value       = aws_wafv2_web_acl.main.id
}

output "web_acl_name" {
  description = "Name of the WAF Web ACL"
  value       = aws_wafv2_web_acl.main.name
}

output "allowed_ips_arn" {
  description = "ARN of the allowed IPs set"
  value       = length(var.allowed_ip_addresses) > 0 ? aws_wafv2_ip_set.allowed_ips[0].arn : null
}

output "blocked_ips_arn" {
  description = "ARN of the blocked IPs set"
  value       = length(var.blocked_ip_addresses) > 0 ? aws_wafv2_ip_set.blocked_ips[0].arn : null
}

output "cloudwatch_alarms" {
  description = "CloudWatch alarms created for WAF monitoring"
  value = {
    blocked_requests_alarm = aws_cloudwatch_metric_alarm.waf_blocked_requests.arn
  }
}

output "firehose_role_arn" {
  description = "IAM role ARN for Kinesis Firehose (if logging enabled)"
  value       = var.enable_logging ? aws_iam_role.firehose_role[0].arn : null
}

output "log_delivery_stream_arn" {
  description = "Kinesis Firehose delivery stream ARN for WAF logs"
  value       = var.enable_logging ? aws_kinesis_firehose_delivery_stream.waf_logs[0].arn : null
}