# Variables for Jambonz Media Gateway Module

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where Jambonz will be deployed"
  type        = string
}

variable "private_subnets" {
  description = "List of private subnet IDs for Jambonz instances"
  type        = list(string)
}

variable "target_group_arns" {
  description = "List of target group ARNs for load balancer integration"
  type        = list(string)
  default     = []
}

variable "instance_type" {
  description = "EC2 instance type for Jambonz"
  type        = string
  default     = "c5.2xlarge"
}

variable "ami_id" {
  description = "AMI ID for Jambonz instances (Ubuntu 22.04 LTS recommended)"
  type        = string
  default     = "ami-0c7217cdde317cfec" # Ubuntu 22.04 LTS in ap-south-1
}

variable "key_name" {
  description = "SSH key pair name for instance access"
  type        = string
}

variable "desired_capacity" {
  description = "Desired number of Jambonz instances"
  type        = number
  default     = 2
}

variable "min_size" {
  description = "Minimum number of Jambonz instances"
  type        = number
  default     = 1
}

variable "max_size" {
  description = "Maximum number of Jambonz instances"
  type        = number
  default     = 5
}

variable "root_volume_size" {
  description = "Root volume size in GB"
  type        = number
  default     = 100
}

variable "domain" {
  description = "Domain name for Jambonz configuration"
  type        = string
}

variable "redis_url" {
  description = "Redis connection URL for Jambonz"
  type        = string
}

variable "db_url" {
  description = "Database connection URL for Jambonz"
  type        = string
}

variable "secrets_arn" {
  description = "ARN of Secrets Manager secret containing Jambonz credentials"
  type        = string
}

variable "jwt_secret_arn" {
  description = "ARN of Secrets Manager secret containing JWT secret"
  type        = string
}

variable "sip_allowed_cidrs" {
  description = "CIDR blocks allowed for SIP traffic"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Restrict this in production
}

variable "admin_allowed_cidrs" {
  description = "CIDR blocks allowed for admin access"
  type        = list(string)
  default     = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
