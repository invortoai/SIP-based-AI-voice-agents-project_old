# Monitoring and Observability Module
# Provides CloudWatch dashboards, alarms, and monitoring for the Invorto platform

locals {
  name_prefix = "invorto-monitoring"
  tags = merge(var.tags, {
    Service = "monitoring"
    Component = "observability"
  })
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
  
  tags = local.tags
}

# SNS Topic Subscription for Email (optional)
resource "aws_sns_topic_subscription" "email_alerts" {
  count     = var.enable_email_alerts ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# SNS Topic Subscription for Slack (optional)
resource "aws_sns_topic_subscription" "slack_alerts" {
  count     = var.enable_slack_alerts ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "https"
  endpoint  = var.slack_webhook_url
}

# CloudWatch Dashboard for Infrastructure Overview
resource "aws_cloudwatch_dashboard" "infrastructure" {
  dashboard_name = "${local.name_prefix}-infrastructure"

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
            ["AWS/ECS", "CPUUtilization", "ServiceName", "invorto-realtime", "ClusterName", "invorto-cluster"],
            [".", "CPUUtilization", "ServiceName", "invorto-api", "ClusterName", "invorto-cluster"],
            [".", "CPUUtilization", "ServiceName", "invorto-webhooks", "ClusterName", "invorto-cluster"],
            [".", "CPUUtilization", "ServiceName", "invorto-workers", "ClusterName", "invorto-cluster"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "ECS Service CPU Utilization"
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
            ["AWS/ECS", "MemoryUtilization", "ServiceName", "invorto-realtime", "ClusterName", "invorto-cluster"],
            [".", "MemoryUtilization", "ServiceName", "invorto-api", "ClusterName", "invorto-cluster"],
            [".", "MemoryUtilization", "ServiceName", "invorto-webhooks", "ClusterName", "invorto-cluster"],
            [".", "MemoryUtilization", "ServiceName", "invorto-workers", "ClusterName", "invorto-cluster"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "ECS Service Memory Utilization"
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
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "invorto-alb"],
            [".", "TargetResponseTime", "LoadBalancer", "invorto-alb"],
            [".", "HTTPCode_Target_5XX_Count", "LoadBalancer", "invorto-alb"]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "ALB Metrics"
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
            ["AWS/ElastiCache", "CPUUtilization", "CacheClusterId", "invorto-redis"],
            [".", "DatabaseMemoryUsagePercentage", "CacheClusterId", "invorto-redis"],
            [".", "CurrConnections", "CacheClusterId", "invorto-redis"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Redis Metrics"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "invorto-postgres"],
            [".", "DatabaseConnections", "DBInstanceIdentifier", "invorto-postgres"],
            [".", "FreeableMemory", "DBInstanceIdentifier", "invorto-postgres"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "PostgreSQL Metrics"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/EC2", "CPUUtilization", "AutoScalingGroupName", "invorto-jambonz-asg"],
            [".", "NetworkIn", "AutoScalingGroupName", "invorto-jambonz-asg"],
            [".", "NetworkOut", "AutoScalingGroupName", "invorto-jambonz-asg"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Jambonz Media Gateway Metrics"
        }
      }
    ]
  })
}

# CloudWatch Dashboard for Application Metrics
resource "aws_cloudwatch_dashboard" "application" {
  dashboard_name = "${local.name_prefix}-application"

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
            ["invorto", "realtime_ws_events_total", "event", "connect"],
            [".", "realtime_ws_events_total", "event", "disconnect"],
            [".", "realtime_ws_events_total", "event", "message"],
            [".", "realtime_ws_events_total", "event", "error"]
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "WebSocket Events"
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
            ["invorto", "http_requests_total", "method", "GET", "path", "/v1/agents"],
            [".", "http_requests_total", "method", "POST", "path", "/v1/agents"],
            [".", "http_requests_total", "method", "GET", "path", "/v1/calls"],
            [".", "http_requests_total", "method", "POST", "path", "/v1/calls"]
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "API Requests"
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
            ["invorto", "call_duration_seconds", "status", "completed"],
            [".", "call_duration_seconds", "status", "failed"],
            [".", "call_duration_seconds", "status", "abandoned"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Call Duration by Status"
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
            ["invorto", "asr_processing_time_seconds"],
            [".", "tts_processing_time_seconds"],
            [".", "llm_response_time_seconds"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "AI Processing Times"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["invorto", "active_calls_total"],
            [".", "concurrent_users_total"],
            [".", "webhook_delivery_success_rate"]
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "Business Metrics"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["invorto", "cost_per_call_inr"],
            [".", "total_calls_today"],
            [".", "average_call_duration_minutes"]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Cost and Usage Metrics"
        }
      }
    ]
  })
}

# CloudWatch Dashboard for Security and Compliance
resource "aws_cloudwatch_dashboard" "security" {
  dashboard_name = "${local.name_prefix}-security"

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
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "invorto-waf"],
            [".", "AllowedRequests", "WebACL", "invorto-waf"],
            [".", "BlockedRequests", "Rule", "RateLimitRule"]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "WAF Security Metrics"
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
            ["invorto", "authentication_failures_total"],
            [".", "authorization_failures_total"],
            [".", "pii_detection_events_total"]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "Security Events"
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
            ["invorto", "compliance_checks_total", "type", "dnd"],
            [".", "compliance_checks_total", "type", "consent"],
            [".", "compliance_checks_total", "type", "data_residency"]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "Compliance Metrics"
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
            ["invorto", "audit_log_events_total"],
            [".", "data_access_events_total"],
            [".", "configuration_changes_total"]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "Audit and Compliance"
        }
      }
    ]
  })
}

# CloudWatch Alarms for Critical Issues

# High CPU Usage Alarm
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "${local.name_prefix}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Average"
  threshold           = "85"
  alarm_description   = "High CPU usage across ECS services"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ServiceName = "invorto-realtime"
    ClusterName = "invorto-cluster"
  }
}

# High Memory Usage Alarm
resource "aws_cloudwatch_metric_alarm" "high_memory" {
  alarm_name          = "${local.name_prefix}-high-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Average"
  threshold           = "85"
  alarm_description   = "High memory usage across ECS services"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ServiceName = "invorto-realtime"
    ClusterName = "invorto-cluster"
  }
}

# High Error Rate Alarm
resource "aws_cloudwatch_metric_alarm" "high_error_rate" {
  alarm_name          = "${local.name_prefix}-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "High 5XX error rate from ALB"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    LoadBalancer = "invorto-alb"
  }
}

# High Response Time Alarm
resource "aws_cloudwatch_metric_alarm" "high_response_time" {
  alarm_name          = "${local.name_prefix}-high-response-time"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Average"
  threshold           = "5"
  alarm_description   = "High response time from ALB targets"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    LoadBalancer = "invorto-alb"
  }
}

# Redis Connection Alarm
resource "aws_cloudwatch_metric_alarm" "redis_connections" {
  alarm_name          = "${local.name_prefix}-redis-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = "300"
  statistic           = "Average"
  threshold           = "1000"
  alarm_description   = "High number of Redis connections"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    CacheClusterId = "invorto-redis"
  }
}

# Database Connection Alarm
resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name          = "${local.name_prefix}-db-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "High number of database connections"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = "invorto-postgres"
  }
}

# Jambonz Health Alarm
resource "aws_cloudwatch_metric_alarm" "jambonz_health" {
  alarm_name          = "${local.name_prefix}-jambonz-health"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = "60"
  statistic           = "Average"
  threshold           = "1"
  alarm_description   = "Jambonz media gateway health check failing"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    TargetGroup  = "invorto-jambonz-tg"
    LoadBalancer = "invorto-alb"
  }
}

# Cost Alarm
resource "aws_cloudwatch_metric_alarm" "cost_threshold" {
  alarm_name          = "${local.name_prefix}-cost-threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = "86400"
  statistic           = "Maximum"
  threshold           = var.monthly_budget
  alarm_description   = "Monthly cost threshold exceeded"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

# Log Group for Application Logs
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/ecs/invorto-application"
  retention_in_days = 30

  tags = local.tags
}

# Log Group for Access Logs
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/alb/invorto-access"
  retention_in_days = 30

  tags = local.tags
}

# Log Group for Error Logs
resource "aws_cloudwatch_log_group" "error" {
  name              = "/aws/ecs/invorto-errors"
  retention_in_days = 90

  tags = local.tags
}
