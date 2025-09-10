output "postgres_exporter_endpoint" {
  description = "PostgreSQL exporter service endpoint"
  value       = var.enable_postgres_exporter ? "http://${aws_ecs_service.postgres_exporter[0].name}:9187" : null
}

output "redis_exporter_endpoint" {
  description = "Redis exporter service endpoint"
  value       = var.enable_redis_exporter ? "http://${aws_ecs_service.redis_exporter[0].name}:9121" : null
}

output "node_exporter_endpoint" {
  description = "Node exporter service endpoint"
  value       = var.enable_node_exporter ? "http://${aws_ecs_service.node_exporter[0].name}:9100" : null
}

output "app_metrics_exporter_endpoint" {
  description = "Application metrics exporter service endpoint"
  value       = var.enable_app_metrics_exporter ? "http://${aws_ecs_service.app_metrics_exporter[0].name}:9090" : null
}

output "postgres_exporter_task_definition_arn" {
  description = "PostgreSQL exporter task definition ARN"
  value       = var.enable_postgres_exporter ? aws_ecs_task_definition.postgres_exporter[0].arn : null
}

output "redis_exporter_task_definition_arn" {
  description = "Redis exporter task definition ARN"
  value       = var.enable_redis_exporter ? aws_ecs_task_definition.redis_exporter[0].arn : null
}

output "node_exporter_task_definition_arn" {
  description = "Node exporter task definition ARN"
  value       = var.enable_node_exporter ? aws_ecs_task_definition.node_exporter[0].arn : null
}

output "app_metrics_exporter_task_definition_arn" {
  description = "Application metrics exporter task definition ARN"
  value       = var.enable_app_metrics_exporter ? aws_ecs_task_definition.app_metrics_exporter[0].arn : null
}

output "postgres_exporter_service_name" {
  description = "PostgreSQL exporter ECS service name"
  value       = var.enable_postgres_exporter ? aws_ecs_service.postgres_exporter[0].name : null
}

output "redis_exporter_service_name" {
  description = "Redis exporter ECS service name"
  value       = var.enable_redis_exporter ? aws_ecs_service.redis_exporter[0].name : null
}

output "node_exporter_service_name" {
  description = "Node exporter ECS service name"
  value       = var.enable_node_exporter ? aws_ecs_service.node_exporter[0].name : null
}

output "app_metrics_exporter_service_name" {
  description = "Application metrics exporter ECS service name"
  value       = var.enable_app_metrics_exporter ? aws_ecs_service.app_metrics_exporter[0].name : null
}

output "security_groups" {
  description = "Security groups created for exporters"
  value = {
    postgres_exporter = var.enable_postgres_exporter ? aws_security_group.postgres_exporter[0].id : null
    redis_exporter    = var.enable_redis_exporter ? aws_security_group.redis_exporter[0].id : null
    node_exporter     = var.enable_node_exporter ? aws_security_group.node_exporter[0].id : null
    app_metrics_exporter = var.enable_app_metrics_exporter ? aws_security_group.app_metrics_exporter[0].id : null
  }
}