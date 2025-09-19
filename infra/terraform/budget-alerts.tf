# Budget Alerts with CloudWatch

resource "aws_cloudwatch_metric_alarm" "daily_cost_alert" {
  alarm_name          = "${var.project_name}-daily-cost-alert-${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = "1"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = "86400" # 24 hours
  statistic           = "Maximum"
  threshold           = var.monthly_budget / 30 # Daily budget threshold
  alarm_description   = "This metric monitors daily estimated charges"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

resource "aws_cloudwatch_metric_alarm" "monthly_cost_alert" {
  alarm_name          = "$${var.project_name}-monthly-cost-alert-$${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = "1"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = "2592000" # 30 days
  statistic           = "Maximum"
  threshold           = var.monthly_budget * 0.8 # 80% of monthly budget
  alarm_description   = "This metric monitors monthly estimated charges"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

resource "aws_cloudwatch_metric_alarm" "budget_forecast_alert" {
  alarm_name          = "$${var.project_name}-budget-forecast-alert-$${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = "1"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = "2592000" # 30 days
  statistic           = "Maximum"
  threshold           = var.monthly_budget * 0.9 # 90% of monthly budget
  alarm_description   = "This metric monitors forecasted budget usage"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

resource "aws_sns_topic" "budget_alerts" {
  name = "$${var.project_name}-budget-alerts-$${var.environment}"
}

resource "aws_sns_topic_subscription" "budget_alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_subscription" "budget_alerts_slack" {
  count     = var.slack_webhook_url != "" ? 1 : 0
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "https"
  endpoint  = var.slack_webhook_url
}

# Custom metrics for application-level cost tracking
resource "aws_cloudwatch_metric_alarm" "high_cost_per_call" {
  alarm_name          = "$${var.project_name}-high-cost-per-call-$${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "5"
  metric_name         = "cost_per_call"
  namespace           = "Invorto/Application"
  period              = "60"
  statistic           = "Average"
  threshold           = 5.0 # INR 5 per call
  alarm_description   = "This metric monitors high cost per call"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "daily_tenant_cost_limit" {
  alarm_name          = "$${var.project_name}-daily-tenant-cost-limit-$${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "daily_cost"
  namespace           = "Invorto/Application"
  period              = "86400" # 24 hours
  statistic           = "Sum"
  threshold           = var.daily_cost_limit # Configurable daily cost limit
  alarm_description   = "This metric monitors daily tenant cost limits"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]
}