# Outputs for Jambonz Media Gateway Module

output "autoscaling_group_name" {
  description = "Name of the Jambonz Auto Scaling Group"
  value       = aws_autoscaling_group.jambonz.name
}

output "autoscaling_group_arn" {
  description = "ARN of the Jambonz Auto Scaling Group"
  value       = aws_autoscaling_group.jambonz.arn
}

output "launch_template_id" {
  description = "ID of the Jambonz Launch Template"
  value       = aws_launch_template.jambonz.id
}

output "launch_template_arn" {
  description = "ARN of the Jambonz Launch Template"
  value       = aws_launch_template.jambonz.arn
}

output "security_group_id" {
  description = "ID of the Jambonz Security Group"
  value       = aws_security_group.jambonz.id
}

output "security_group_arn" {
  description = "ARN of the Jambonz Security Group"
  value       = aws_security_group.jambonz.arn
}

output "iam_role_arn" {
  description = "ARN of the Jambonz IAM Role"
  value       = aws_iam_role.jambonz.arn
}

output "iam_instance_profile_arn" {
  description = "ARN of the Jambonz IAM Instance Profile"
  value       = aws_iam_instance_profile.jambonz.arn
}

output "cloudwatch_log_group_name" {
  description = "Name of the Jambonz CloudWatch Log Group"
  value       = aws_cloudwatch_log_group.jambonz.name
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the Jambonz CloudWatch Log Group"
  value       = aws_cloudwatch_log_group.jambonz.arn
}

output "scale_up_policy_arn" {
  description = "ARN of the scale up Auto Scaling Policy"
  value       = aws_autoscaling_policy.jambonz_scale_up.arn
}

output "scale_down_policy_arn" {
  description = "ARN of the scale down Auto Scaling Policy"
  value       = aws_autoscaling_policy.jambonz_scale_down.arn
}

output "cpu_high_alarm_arn" {
  description = "ARN of the CPU high CloudWatch Alarm"
  value       = aws_cloudwatch_metric_alarm.jambonz_cpu_high.arn
}

output "cpu_low_alarm_arn" {
  description = "ARN of the CPU low CloudWatch Alarm"
  value       = aws_cloudwatch_metric_alarm.jambonz_cpu_low.arn
}
