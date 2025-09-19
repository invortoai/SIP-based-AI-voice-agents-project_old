# Cost Management Module
# Provides comprehensive cost management, budgeting, and optimization for the Invorto platform

locals {
  name_prefix = "invorto-cost"
  tags = merge(var.tags, {
    Service   = "cost-management"
    Component = "governance"
  })
}

# AWS Budget for Monthly Cost
resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly-budget"
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = var.monthly_budget_amount
  limit_unit   = "USD"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 120
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  cost_filters = {
    TagKeyValue = "Environment$${var.environment}"
  }

  tags = local.tags
}

# AWS Budget for Daily Cost
resource "aws_budgets_budget" "daily" {
  name         = "${local.name_prefix}-daily-budget"
  budget_type  = "COST"
  time_unit    = "DAILY"
  limit_amount = var.daily_budget_amount
  limit_unit   = "USD"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  cost_filters = {
    TagKeyValue = "Environment$${var.environment}"
  }

  tags = local.tags
}

# AWS Budget for Usage
resource "aws_budgets_budget" "usage" {
  name         = "${local.name_prefix}-usage-budget"
  budget_type  = "USAGE"
  time_unit    = "MONTHLY"
  limit_amount = var.monthly_usage_limit
  limit_unit   = "GB-MONTHS"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  cost_filters = {
    TagKeyValue = "Environment$${var.environment}"
  }

  tags = local.tags
}

# SNS Topic for Cost Alerts
resource "aws_sns_topic" "cost_alerts" {
  name = "${local.name_prefix}-alerts"

  tags = local.tags
}

# SNS Topic Subscription for Cost Alerts
resource "aws_sns_topic_subscription" "cost_email" {
  count     = var.enable_cost_email_alerts ? 1 : 0
  topic_arn = aws_sns_topic.cost_alerts.arn
  protocol  = "email"
  endpoint  = var.cost_alert_email
}

# SNS Topic Subscription for Slack Cost Alerts
resource "aws_sns_topic_subscription" "cost_slack" {
  count     = var.enable_cost_slack_alerts ? 1 : 0
  topic_arn = aws_sns_topic.cost_alerts.arn
  protocol  = "https"
  endpoint  = var.cost_slack_webhook_url
}

# CloudWatch Dashboard for Cost Monitoring
resource "aws_cloudwatch_dashboard" "cost" {
  dashboard_name = "${local.name_prefix}-cost-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/Billing", "EstimatedCharges", "Currency", "USD"],
            [".", "EstimatedCharges", "Currency", "INR"]
          ]
          period = 86400
          stat   = "Maximum"
          region = "us-east-1"
          title  = "Estimated Charges (Daily)"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/EC2", "CPUUtilization", "AutoScalingGroupName", "invorto-jambonz-asg"],
            [".", "CPUUtilization", "AutoScalingGroupName", "invorto-ecs-cluster"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "EC2 CPU Utilization"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "CacheClusterId", "invorto-redis"],
            [".", "CurrConnections", "CacheClusterId", "invorto-redis"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Redis Memory and Connections"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "invorto-postgres"],
            [".", "FreeableMemory", "DBInstanceIdentifier", "invorto-postgres"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Connections and Memory"
        }
      }
    ]
  })
}

# CloudWatch Alarms for Cost Monitoring
resource "aws_cloudwatch_metric_alarm" "cost_threshold" {
  alarm_name          = "${local.name_prefix}-cost-threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = "86400"
  statistic           = "Maximum"
  threshold           = var.daily_cost_threshold
  alarm_description   = "Daily cost threshold exceeded"
  alarm_actions       = [aws_sns_topic.cost_alerts.arn]

  dimensions = {
    Currency = "USD"
  }

  tags = local.tags
}

# CloudWatch Alarm for High CPU Usage (Cost Impact)
resource "aws_cloudwatch_metric_alarm" "high_cpu_cost" {
  alarm_name          = "${local.name_prefix}-high-cpu-cost"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "300"
  statistic           = "Average"
  threshold           = "85"
  alarm_description   = "High CPU usage causing cost inefficiency"
  alarm_actions       = [aws_sns_topic.cost_alerts.arn]

  dimensions = {
    AutoScalingGroupName = "invorto-jambonz-asg"
  }

  tags = local.tags
}

# CloudWatch Alarm for High Memory Usage (Cost Impact)
resource "aws_cloudwatch_metric_alarm" "high_memory_cost" {
  alarm_name          = "${local.name_prefix}-high-memory-cost"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Average"
  threshold           = "85"
  alarm_description   = "High memory usage causing cost inefficiency"
  alarm_actions       = [aws_sns_topic.cost_alerts.arn]

  dimensions = {
    ServiceName = "invorto-realtime"
    ClusterName = "invorto-cluster"
  }

  tags = local.tags
}

# CloudWatch Alarm for Unused Resources
resource "aws_cloudwatch_metric_alarm" "unused_resources" {
  alarm_name          = "${local.name_prefix}-unused-resources"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "4"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "3600"
  statistic           = "Average"
  threshold           = "5"
  alarm_description   = "Low CPU usage indicating potential cost optimization"
  alarm_actions       = [aws_sns_topic.cost_alerts.arn]

  dimensions = {
    AutoScalingGroupName = "invorto-jambonz-asg"
  }

  tags = local.tags
}

# Cost Allocation Tags
resource "aws_ec2_tag" "cost_allocation" {
  for_each = toset([
    "Environment",
    "Project",
    "Service",
    "Component",
    "Owner",
    "CostCenter"
  ])

  resource_id = data.aws_caller_identity.current.account_id
  key         = each.value
  value       = lookup(var.cost_allocation_tags, each.value, "")
}

# AWS Cost Explorer Report
resource "aws_cur_report_definition" "cost_report" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  report_name                = "${local.name_prefix}-cost-report"
  time_unit                  = "DAILY"
  format                     = "Parquet"
  compression                = "GZIP"
  additional_schema_elements = ["RESOURCES"]
  s3_bucket                  = aws_s3_bucket.cost_reports[0].id
  s3_region                  = var.aws_region
  additional_artifacts       = ["ATHENA"]
  refresh_closed_reports     = true
  report_versioning          = "OVERWRITE_REPORT"

  report_definition {
    report_name                = "${local.name_prefix}-cost-report"
    time_unit                  = "DAILY"
    format                     = "Parquet"
    compression                = "GZIP"
    additional_schema_elements = ["RESOURCES"]
    s3_bucket                  = aws_s3_bucket.cost_reports[0].id
    s3_region                  = var.aws_region
    additional_artifacts       = ["ATHENA"]
    refresh_closed_reports     = true
    report_versioning          = "OVERWRITE_REPORT"
  }
}

# S3 Bucket for Cost Reports
resource "aws_s3_bucket" "cost_reports" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  bucket = "${local.name_prefix}-reports-${random_string.bucket_suffix.result}"

  tags = local.tags
}

# Random string for unique bucket names
resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

# S3 Bucket Versioning for Cost Reports
resource "aws_s3_bucket_versioning" "cost_reports" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  bucket = aws_s3_bucket.cost_reports[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Encryption for Cost Reports
resource "aws_s3_bucket_server_side_encryption_configuration" "cost_reports" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  bucket = aws_s3_bucket.cost_reports[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Lifecycle Policy for Cost Reports
resource "aws_s3_bucket_lifecycle_configuration" "cost_reports" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  bucket = aws_s3_bucket.cost_reports[0].id

  rule {
    id     = "cost_reports_lifecycle"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 2555 # 7 years
    }
  }
}

# IAM Role for Cost Explorer
resource "aws_iam_role" "cost_explorer" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  name = "${local.name_prefix}-cost-explorer-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "cur.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Policy for Cost Explorer
resource "aws_iam_role_policy" "cost_explorer" {
  count = var.enable_cost_explorer_reports ? 1 : 0

  name = "${local.name_prefix}-cost-explorer-policy"
  role = aws_iam_role.cost_explorer[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [
          "${aws_s3_bucket.cost_reports[0].arn}/*"
        ]
      }
    ]
  })
}

# CloudWatch Log Group for Cost Management
resource "aws_cloudwatch_log_group" "cost_management" {
  name              = "/aws/cost-management/${local.name_prefix}"
  retention_in_days = 90

  tags = local.tags
}

# Data source for current AWS account
data "aws_caller_identity" "current" {}
