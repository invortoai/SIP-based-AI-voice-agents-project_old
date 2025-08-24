output "dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "realtime_tg_arn" {
  description = "Realtime target group ARN"
  value       = aws_lb_target_group.realtime.arn
}

output "api_tg_arn" {
  description = "API target group ARN"
  value       = aws_lb_target_group.api.arn
}
