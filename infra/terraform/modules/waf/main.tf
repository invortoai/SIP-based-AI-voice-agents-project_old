# AWS WAF v2 Configuration for Invorto Voice AI Platform
# Provides comprehensive web application firewall protection

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# WAF Web ACL
resource "aws_wafv2_web_acl" "main" {
  name        = "$${var.project_name}-waf-$${var.environment}"
  description = "WAF for Invorto Voice AI Platform"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # Rate limiting rule - protects against DDoS and abuse
  rule {
    name     = "RateLimit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"

        scope_down_statement {
          geo_match_statement {
            country_codes = var.allowed_countries
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "$${var.project_name}-RateLimit-$${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # SQL Injection protection
  rule {
    name     = "SQLInjection"
    priority = 2

    action {
      block {}
    }

    statement {
      or_statement {
        statement {
          sqli_match_statement {
            field_to_match {
              body {}
            }
            text_transformation {
              priority = 1
              type     = "URL_DECODE"
            }
            text_transformation {
              priority = 2
              type     = "HTML_ENTITY_DECODE"
            }
          }
        }
        statement {
          sqli_match_statement {
            field_to_match {
              query_string {}
            }
            text_transformation {
              priority = 1
              type     = "URL_DECODE"
            }
            text_transformation {
              priority = 2
              type     = "HTML_ENTITY_DECODE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "$${var.project_name}-SQLInjection-$${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # XSS protection
  rule {
    name     = "XSS"
    priority = 3

    action {
      block {}
    }

    statement {
      xss_match_statement {
        field_to_match {
          body {}
        }
        text_transformation {
          priority = 1
          type     = "URL_DECODE"
        }
        text_transformation {
          priority = 2
          type     = "HTML_ENTITY_DECODE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "$${var.project_name}-XSS-$${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # IP allowlist for trusted sources
  dynamic "rule" {
    for_each = length(var.allowed_ip_addresses) > 0 ? [1] : []

    content {
      name     = "AllowTrustedIPs"
      priority = 4

      action {
        allow {}
      }

      statement {
        ip_set_reference_statement {
          arn = aws_wafv2_ip_set.allowed_ips[0].arn
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "$${var.project_name}-AllowTrustedIPs-$${var.environment}"
        sampled_requests_enabled   = true
      }
    }
  }

  # IP blocklist for malicious sources
  dynamic "rule" {
    for_each = length(var.blocked_ip_addresses) > 0 ? [1] : []

    content {
      name     = "BlockMaliciousIPs"
      priority = 5

      action {
        block {}
      }

      statement {
        ip_set_reference_statement {
          arn = aws_wafv2_ip_set.blocked_ips[0].arn
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "$${var.project_name}-BlockMaliciousIPs-$${var.environment}"
        sampled_requests_enabled   = true
      }
    }
  }

  # Geo-blocking for non-allowed countries
  dynamic "rule" {
    for_each = length(var.blocked_countries) > 0 ? [1] : []

    content {
      name     = "GeoBlock"
      priority = 6

      action {
        block {}
      }

      statement {
        geo_match_statement {
          country_codes = var.blocked_countries
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "$${var.project_name}-GeoBlock-$${var.environment}"
        sampled_requests_enabled   = true
      }
    }
  }

  # Bad bot protection
  rule {
    name     = "BadBot"
    priority = 7

    action {
      block {}
    }

    statement {
      byte_match_statement {
        field_to_match {
          single_header {
            name = "user-agent"
          }
        }
        positional_constraint = "CONTAINS"
        search_string         = var.bad_bot_user_agents
        text_transformation {
          priority = 1
          type     = "LOWERCASE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "$${var.project_name}-BadBot-$${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - Common Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 8

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "$${var.project_name}-AWSManagedRulesCommon-$${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 9

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "$${var.project_name}-AWSManagedRulesBadInputs-$${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - SQL Database
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-AWSManagedRulesSQLi-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "$${var.project_name}-waf-$${var.environment}"
    sampled_requests_enabled   = true
  }
}

# IP Sets for allowlist and blocklist
resource "aws_wafv2_ip_set" "allowed_ips" {
  count = length(var.allowed_ip_addresses) > 0 ? 1 : 0

  name               = "$${var.project_name}-allowed-ips-$${var.environment}"
  description        = "Allowed IP addresses for Invorto"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.allowed_ip_addresses
}

resource "aws_wafv2_ip_set" "blocked_ips" {
  count = length(var.blocked_ip_addresses) > 0 ? 1 : 0

  name               = "$${var.project_name}-blocked-ips-$${var.environment}"
  description        = "Blocked IP addresses for Invorto"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.blocked_ip_addresses
}

# Associate WAF with ALB
resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# CloudWatch Alarms for WAF metrics
resource "aws_cloudwatch_metric_alarm" "waf_blocked_requests" {
  alarm_name          = "$${var.project_name}-waf-blocked-requests-$${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  period              = "300"
  statistic           = "Sum"
  threshold           = var.blocked_requests_threshold
  alarm_description   = "WAF blocked requests threshold exceeded"
  alarm_actions       = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []

  dimensions = {
    WebACL = aws_wafv2_web_acl.main.name
    Region = var.aws_region
  }
}

# WAF Logging
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  count = var.enable_logging ? 1 : 0

  resource_arn            = aws_wafv2_web_acl.main.arn
  log_destination_configs = [aws_kinesis_firehose_delivery_stream.waf_logs[0].arn]
}

resource "aws_kinesis_firehose_delivery_stream" "waf_logs" {
  count = var.enable_logging ? 1 : 0

  name        = "$${var.project_name}-waf-logs-$${var.environment}"
  destination = "s3"

  s3_configuration {
    role_arn   = aws_iam_role.firehose_role[0].arn
    bucket_arn = var.log_bucket_arn
    prefix     = "waf-logs/"

    buffering_size     = 64
    buffering_interval = 300
    compression_format = "GZIP"
  }
}

resource "aws_iam_role" "firehose_role" {
  count = var.enable_logging ? 1 : 0

  name = "$${var.project_name}-waf-firehose-$${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "firehose.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "firehose_policy" {
  count = var.enable_logging ? 1 : 0

  name = "$${var.project_name}-waf-firehose-policy-$${var.environment}"
  role = aws_iam_role.firehose_role[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = [
          var.log_bucket_arn,
          "${var.log_bucket_arn}/*"
        ]
      }
    ]
  })
}