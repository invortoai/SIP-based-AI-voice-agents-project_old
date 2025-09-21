# Jambonz Media Gateway Module
# Handles SIP telephony infrastructure for voice calls

locals {
  name_prefix = "invorto-jambonz"
  tags = merge(var.tags, {
    Service   = "jambonz-media"
    Component = "telephony"
  })
}
# Lookup latest Ubuntu 22.04 (Jammy) AMI in this region
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

# Security Group for Jambonz Media Gateway
resource "aws_security_group" "jambonz" {
  name_prefix = "${local.name_prefix}-sg"
  description = "Security group for Jambonz Media Gateway"
  vpc_id      = var.vpc_id

  # SIP Signaling (UDP 5060)
  ingress {
    description = "SIP Signaling"
    from_port   = 5060
    to_port     = 5060
    protocol    = "udp"
    cidr_blocks = var.sip_allowed_cidrs
  }

  # RTP Media (UDP 10000-20000)
  ingress {
    description = "RTP Media Streams"
    from_port   = 10000
    to_port     = 20000
    protocol    = "udp"
    cidr_blocks = var.sip_allowed_cidrs
  }

  # HTTP/HTTPS for Jambonz Admin
  ingress {
    description = "Jambonz Admin HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.admin_allowed_cidrs
  }

  ingress {
    description = "Jambonz Admin HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.admin_allowed_cidrs
  }

  # SSH for administration
  ingress {
    description = "SSH Access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.admin_allowed_cidrs
  }

  # All outbound traffic
  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# IAM Role for Jambonz instances
resource "aws_iam_role" "jambonz" {
  name = "${local.name_prefix}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "jambonz" {
  name = "${local.name_prefix}-profile"
  role = aws_iam_role.jambonz.name
}

# IAM Policy for Jambonz
resource "aws_iam_role_policy" "jambonz" {
  name = "${local.name_prefix}-policy"
  role = aws_iam_role.jambonz.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeTags",
          "ec2:DescribeRegions",
          "ec2:DescribeAvailabilityZones"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = var.secrets_arn
      }
    ]
  })
}

# Launch Template for Jambonz instances
resource "aws_launch_template" "jambonz" {
  name_prefix   = local.name_prefix
  image_id      = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu.id
  instance_type = var.instance_type

  key_name = var.key_name != "" ? var.key_name : null

  vpc_security_group_ids = [aws_security_group.jambonz.id]
  iam_instance_profile {
    name = aws_iam_instance_profile.jambonz.name
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    environment = var.environment
    domain      = var.domain
    redis_url   = var.redis_url
    db_url      = var.db_url
    secrets_arn = var.secrets_arn
    JWT_SECRET  = var.jwt_secret_arn
  }))

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.root_volume_size
      volume_type           = "gp3"
      delete_on_termination = true
      encrypted             = true
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  monitoring {
    enabled = true
  }

  tag_specifications {
    resource_type = "instance"
    tags          = local.tags
  }

  tag_specifications {
    resource_type = "volume"
    tags          = local.tags
  }

  tags = local.tags
}

# Auto Scaling Group
resource "aws_autoscaling_group" "jambonz" {
  name                = "${local.name_prefix}-asg"
  desired_capacity    = var.desired_capacity
  max_size            = var.max_size
  min_size            = var.min_size
  target_group_arns   = var.target_group_arns
  vpc_zone_identifier = var.private_subnets

  health_check_type = "ELB"

  # Health check grace period for Jambonz startup
  health_check_grace_period = 600

  # Mixed instances policy for cost optimization
  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 1
      on_demand_percentage_above_base_capacity = 100
      spot_allocation_strategy                 = "capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.jambonz.id
        version            = "$Latest"
      }

      override {
        instance_type     = "c5.2xlarge"
        weighted_capacity = "2"
      }

      override {
        instance_type     = "c5.xlarge"
        weighted_capacity = "1"
      }

      override {
        instance_type     = "c5.4xlarge"
        weighted_capacity = "4"
      }
    }
  }

  # Auto scaling policies
  dynamic "tag" {
    for_each = local.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }

  # Instance refresh policy
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
      max_healthy_percentage = 100
    }
  }
}

# Auto Scaling Policies
resource "aws_autoscaling_policy" "jambonz_scale_up" {
  name                   = "${local.name_prefix}-scale-up"
  scaling_adjustment     = 1
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 300
  autoscaling_group_name = aws_autoscaling_group.jambonz.name
}

resource "aws_autoscaling_policy" "jambonz_scale_down" {
  name                   = "${local.name_prefix}-scale-down"
  scaling_adjustment     = -1
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 300
  autoscaling_group_name = aws_autoscaling_group.jambonz.name
}

# CloudWatch Alarms for Auto Scaling
resource "aws_cloudwatch_metric_alarm" "jambonz_cpu_high" {
  alarm_name          = "${local.name_prefix}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "Scale up if CPU > 80% for 10 minutes"
  alarm_actions       = [aws_autoscaling_policy.jambonz_scale_up.arn]

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.jambonz.name
  }
}

resource "aws_cloudwatch_metric_alarm" "jambonz_cpu_low" {
  alarm_name          = "${local.name_prefix}-cpu-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "300"
  statistic           = "Average"
  threshold           = "20"
  alarm_description   = "Scale down if CPU < 20% for 10 minutes"
  alarm_actions       = [aws_autoscaling_policy.jambonz_scale_down.arn]

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.jambonz.name
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "jambonz" {
  name              = "/aws/ec2/${local.name_prefix}"
  retention_in_days = 30

  tags = local.tags
}
