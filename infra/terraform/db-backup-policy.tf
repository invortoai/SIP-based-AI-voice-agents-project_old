# Database Backup and Retention Policies

resource "aws_backup_vault" "db_backup_vault" {
  name        = "$${var.project_name}-db-backup-vault-$${var.environment}"
  kms_key_arn = aws_kms_key.db_backup_key.arn
}

resource "aws_backup_selection" "db_backup_selection" {
  name         = "$${var.project_name}-db-backup-selection-$${var.environment}"
  plan_id      = aws_backup_plan.db_backup_plan.id
  iam_role_arn = aws_iam_role.backup_role.arn

  resources = [
    aws_db_instance.main.arn
  ]
}

resource "aws_backup_plan" "db_backup_plan" {
  name = "$${var.project_name}-db-backup-plan-$${var.environment}"

  rule {
    rule_name         = "DailyBackups"
    target_vault_name = aws_backup_vault.db_backup_vault.name
    schedule          = "cron(0 3 * * ? *)" # Daily at 3 AM UTC

    lifecycle {
      delete_after = var.db_backup_retention_days # Keep backups for specified days
    }
  }

  rule {
    rule_name         = "WeeklyBackups"
    target_vault_name = aws_backup_vault.db_backup_vault.name
    schedule          = "cron(0 4 ? * SUN *)" # Weekly on Sunday at 4 AM UTC

    lifecycle {
      delete_after = var.db_weekly_backup_retention_days # Keep weekly backups for specified days
    }
  }

  rule {
    rule_name         = "MonthlyBackups"
    target_vault_name = aws_backup_vault.db_backup_vault.name
    schedule          = "cron(0 5 1 * ? *)" # First day of month at 5 AM UTC

    lifecycle {
      delete_after = var.db_monthly_backup_retention_days # Keep monthly backups for specified days
    }
  }
}

resource "aws_kms_key" "db_backup_key" {
  description             = "KMS key for DB backup encryption"
  deletion_window_in_days = 10
}

resource "aws_iam_role" "backup_role" {
  name = "${var.project_name}-backup-role-${var.environment}"

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
}

resource "aws_iam_role_policy_attachment" "backup_role_policy" {
  role       = aws_iam_role.backup_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}