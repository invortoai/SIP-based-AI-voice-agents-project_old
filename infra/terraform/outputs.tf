output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnets
}

output "public_subnets" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnets
}

# output "alb_dns_name" {
#   description = "ALB DNS name"
#   value       = module.alb.dns_name
# }

output "redis_endpoint" {
  description = "Redis ElastiCache endpoint"
  value       = module.redis.endpoint
}

output "s3_buckets" {
  description = "S3 bucket names"
  value       = module.s3.bucket_names
}

# output "ecs_cluster_name" {
#   description = "ECS cluster name"
#   value       = module.ecs_cluster.name
# }
