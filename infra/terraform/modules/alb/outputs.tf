output "dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "zone_id" {
  description = "ALB hosted zone id (for Route53 alias)"
  value       = aws_lb.main.zone_id
}

output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.main.arn
}

output "security_group_id" {
  description = "ALB Security Group ID"
  value       = aws_security_group.alb.id
}
