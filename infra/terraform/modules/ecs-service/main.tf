variable "cluster_arn" { type = string }
variable "cluster_name" { type = string }
variable "service_name" { type = string }
variable "container_name" { type = string }
variable "container_port" { type = number }
variable "image" { type = string }
variable "cpu" { type = number }
variable "memory" { type = number }
variable "subnets" { type = list(string) }
variable "security_groups" { type = list(string) }
variable "target_group_arn" {
  type    = string
  default = ""
}
variable "log_group" {
  type = string
}
variable "desired_count" {
  type    = number
  default = 1
}
variable "enable_load_balancer" {
  type    = bool
  default = true
}
variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "environment" {
  type    = map(string)
  default = {}
}
variable "secrets" {
  type = list(object({
    name      = string
    valueFrom = string
  }))
  default = []
}

resource "aws_iam_role" "task_role" {
  name = "${var.service_name}-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role" "execution_role" {
  name = "${var.service_name}-exec-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "exec_attach" {
  role       = aws_iam_role.execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "task" {
  family                   = var.service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution_role.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([
    {
      name      = var.container_name,
      image     = var.image,
      essential = true,
      portMappings = [{
        containerPort = var.container_port
        protocol      = "tcp"
      }]
      environment = [
        for k, v in var.environment : {
          name  = k
          value = v
        }
      ]
      secrets = var.secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = var.log_group
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = var.service_name
        }
      }
    }
  ])
}

resource "aws_ecs_service" "svc" {
  name            = var.service_name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.task.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnets
    security_groups  = var.security_groups
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.enable_load_balancer ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = var.container_name
      container_port   = var.container_port
    }
  }

  lifecycle { ignore_changes = [desired_count] }
}
