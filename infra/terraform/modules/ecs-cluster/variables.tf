variable "vpc_id" {
  description = "ID of the VPC where ECS cluster will be created"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "production"
}