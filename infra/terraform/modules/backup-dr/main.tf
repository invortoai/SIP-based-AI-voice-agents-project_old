# Backup and Disaster Recovery Module
# Provides comprehensive backup strategies and disaster recovery for the Invorto platform

locals {
  name_prefix = "invorto-backup-dr"
  tags = merge(var.tags, {
    Service = "backup-dr"
    Component = "resilience"
  })
}

# AWS Backup Vault
resource "aws_backup_vault" "main" {
  name = "$${local.name_prefix}-vault"
  
  tags = local.tags
}

# AWS Backup Vault Lock Configuration (Optional)
resource "aws_backup_vault_lock_configuration" "main" {
  count = var.enable_backup_vault_lock ? 1 : 0
  
  backup_vault_name = aws_backup_vault.main.name
  changeable_for_days = var.backup_vault_lock_days
}

# AWS Backup Plan
resource "aws_backup_plan" "main" {
  name = "$${local.name_prefix}-plan"

  rule {
    rule_name         = "daily_backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 2 * * ? *)" # Daily at 2 AM UTC

    lifecycle {
      delete_after = var.daily_backup_retention_days
    }

    copy_action {
      destination_vault_arn = var.enable_cross_region_backup ? aws_backup_vault.dr[0].arn : null
    }
  }

  rule {
    rule_name         = "weekly_backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 3 ? * SUN *)" # Weekly on Sunday at 3 AM UTC

    lifecycle {
      delete_after = var.weekly_backup_retention_days
    }

    copy_action {
      destination_vault_arn = var.enable_cross_region_backup ? aws_backup_vault.dr[0].arn : null
    }
  }

  rule {
    rule_name         = "monthly_backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 4 1 * ? *)" # Monthly on 1st at 4 AM UTC

    lifecycle {
      delete_after = var.monthly_backup_retention_days
    }

    copy_action {
      destination_vault_arn = var.enable_cross_region_backup ? aws_backup_vault.dr[0].arn : null
    }
  }

  tags = local.tags
}

# Cross-Region Backup Vault (Disaster Recovery)
resource "aws_backup_vault" "dr" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  provider = aws.dr_region
  name     = "${local.name_prefix}-dr-vault"
  
  tags = merge(local.tags, {
    Purpose = "disaster-recovery"
  })
}

# AWS Backup Selection for ECS Resources
resource "aws_backup_selection" "ecs" {
  name         = "${local.name_prefix}-ecs-selection"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.main.id

  resources = [
    "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/*",
    "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/*",
    "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/*"
  ]

  tags = local.tags
}

# AWS Backup Selection for RDS Resources
resource "aws_backup_selection" "rds" {
  name         = "$${local.name_prefix}-rds-selection"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.main.id

  resources = [
    "arn:aws:rds:${var.aws_region}:${data.aws_caller_identity.current.account_id}:db:*"
  ]

  tags = local.tags
}

# AWS Backup Selection for EFS Resources
resource "aws_backup_selection" "efs" {
  name         = "$${local.name_prefix}-efs-selection"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.main.id

  resources = [
    "arn:aws:elasticfilesystem:${var.aws_region}:${data.aws_caller_identity.current.account_id}:file-system/*"
  ]

  tags = local.tags
}

# IAM Role for AWS Backup
resource "aws_iam_role" "backup" {
  name = "$${local.name_prefix}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Policy for AWS Backup
resource "aws_iam_role_policy_attachment" "backup" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
  role       = aws_iam_role.backup.name
}

# IAM Policy for AWS Backup Restore
resource "aws_iam_role_policy_attachment" "backup_restore" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
  role       = aws_iam_role.backup.name
}

# S3 Bucket for Application Data Backup
resource "aws_s3_bucket" "application_backup" {
  bucket = "$${local.name_prefix}-app-data-$${random_string.bucket_suffix.result}"
  
  tags = local.tags
}

# Random string for unique bucket names
resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "application_backup" {
  bucket = aws_s3_bucket.application_backup.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "application_backup" {
  bucket = aws_s3_bucket.application_backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Lifecycle Policy
resource "aws_s3_bucket_lifecycle_configuration" "application_backup" {
  bucket = aws_s3_bucket.application_backup.id

  rule {
    id     = "backup_lifecycle"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }

    expiration {
      days = 2555 # 7 years
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# S3 Bucket for Configuration Backup
resource "aws_s3_bucket" "config_backup" {
  bucket = "$${local.name_prefix}-config-$${random_string.bucket_suffix.result}"
  
  tags = local.tags
}

# S3 Bucket Versioning for Config
resource "aws_s3_bucket_versioning" "config_backup" {
  bucket = aws_s3_bucket.config_backup.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Encryption for Config
resource "aws_s3_bucket_server_side_encryption_configuration" "config_backup" {
  bucket = aws_s3_bucket.config_backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Lifecycle Policy for Config
resource "aws_s3_bucket_lifecycle_configuration" "config_backup" {
  bucket = aws_s3_bucket.config_backup.id

  rule {
    id     = "config_lifecycle"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }

    expiration {
      days = 2555 # 7 years
    }
  }
}

# Cross-Region Replication for Application Data
resource "aws_s3_bucket_replication_configuration" "application_backup" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  depends_on = [aws_s3_bucket_versioning.application_backup]
  
  role   = aws_iam_role.replication[0].arn
  bucket = aws_s3_bucket.application_backup.id

  rule {
    id     = "cross_region_replication"
    status = "Enabled"

    destination {
      bucket        = aws_s3_bucket.dr_application_backup[0].arn
      storage_class = "STANDARD"
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
  }
}

# Cross-Region S3 Bucket for Application Data
resource "aws_s3_bucket" "dr_application_backup" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  provider = aws.dr_region
  bucket   = "$${local.name_prefix}-dr-app-data-$${random_string.bucket_suffix.result}"
  
  tags = merge(local.tags, {
    Purpose = "disaster-recovery"
  })
}

# Cross-Region S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "dr_application_backup" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  provider = aws.dr_region
  bucket   = aws_s3_bucket.dr_application_backup[0].id
  
  versioning_configuration {
    status = "Enabled"
  }
}

# Cross-Region S3 Bucket Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "dr_application_backup" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  provider = aws.dr_region
  bucket   = aws_s3_bucket.dr_application_backup[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# IAM Role for S3 Replication
resource "aws_iam_role" "replication" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  name = "$${local.name_prefix}-replication-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Policy for S3 Replication
resource "aws_iam_role_policy" "replication" {
  count = var.enable_cross_region_backup ? 1 : 0
  
  name = "$${local.name_prefix}-replication-policy"
  role = aws_iam_role.replication[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = [aws_s3_bucket.application_backup.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = ["${aws_s3_bucket.application_backup.arn}/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = ["${aws_s3_bucket.dr_application_backup[0].arn}/*"]
      }
    ]
  })
}

# CloudWatch Log Group for Backup Operations
resource "aws_cloudwatch_log_group" "backup" {
  name              = "/aws/backup/${local.name_prefix}"
  retention_in_days = 90

  tags = local.tags
}

# CloudWatch Dashboard for Backup Monitoring
resource "aws_cloudwatch_dashboard" "backup" {
  dashboard_name = "${local.name_prefix}-backup-dashboard"

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
            ["AWS/Backup", "JobsCompleted", "BackupVault", aws_backup_vault.main.name],
            [".", "JobsFailed", "BackupVault", aws_backup_vault.main.name],
            [".", "JobsStarted", "BackupVault", aws_backup_vault.main.name]
          ]
          period = 86400
          stat   = "Sum"
          region = var.aws_region
          title  = "Backup Jobs Status (Daily)"
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
            ["AWS/Backup", "RecoveryPoints", "BackupVault", aws_backup_vault.main.name]
          ]
          period = 3600
          stat   = "Average"
          region = var.aws_region
          title  = "Recovery Points Count"
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
            ["AWS/Backup", "BackupJobDuration", "BackupVault", aws_backup_vault.main.name]
          ]
          period = 3600
          stat   = "Average"
          region = var.aws_region
          title  = "Backup Job Duration"
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
            ["AWS/Backup", "RestoreJobDuration", "BackupVault", aws_backup_vault.main.name]
          ]
          period = 3600
          stat   = "Average"
          region = var.aws_region
          title  = "Restore Job Duration"
        }
      }
    ]
  })
}

# CloudWatch Alarms for Backup Monitoring
resource "aws_cloudwatch_metric_alarm" "backup_failures" {
  alarm_name          = "$${local.name_prefix}-backup-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "JobsFailed"
  namespace           = "AWS/Backup"
  period              = "86400"
  statistic           = "Sum"
  threshold           = "0"
  alarm_description   = "Backup jobs are failing"
  alarm_actions       = var.backup_alarm_actions

  dimensions = {
    BackupVault = aws_backup_vault.main.name
  }

  tags = local.tags
}

# CloudWatch Alarm for Recovery Points
resource "aws_cloudwatch_metric_alarm" "recovery_points" {
  alarm_name          = "$${local.name_prefix}-recovery-points"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "RecoveryPoints"
  namespace           = "AWS/Backup"
  period              = "3600"
  statistic           = "Average"
  threshold           = "1"
  alarm_description   = "No recovery points available"
  alarm_actions       = var.backup_alarm_actions

  dimensions = {
    BackupVault = aws_backup_vault.main.name
  }

  tags = local.tags
}

# Data source for current AWS account
data "aws_caller_identity" "current" {}

# Data source for current AWS region
data "aws_region" "current" {}
