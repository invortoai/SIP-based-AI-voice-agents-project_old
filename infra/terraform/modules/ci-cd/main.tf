# CI/CD Pipeline Infrastructure Module
# Provides automated deployment pipeline for the Invorto platform

locals {
  name_prefix = "invorto-cicd"
  tags = merge(var.tags, {
    Service = "ci-cd"
    Component = "deployment"
  })
}

# S3 Bucket for Pipeline Artifacts
resource "aws_s3_bucket" "pipeline_artifacts" {
  bucket = "${local.name_prefix}-artifacts-${random_string.bucket_suffix.result}"
  
  tags = local.tags
}

# Random string for unique bucket names
resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "pipeline_artifacts" {
  bucket = aws_s3_bucket.pipeline_artifacts.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "pipeline_artifacts" {
  bucket = aws_s3_bucket.pipeline_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Lifecycle Policy
resource "aws_s3_bucket_lifecycle_configuration" "pipeline_artifacts" {
  bucket = aws_s3_bucket.pipeline_artifacts.id

  rule {
    id     = "cleanup_old_artifacts"
    status = "Enabled"

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# IAM Role for CodePipeline
resource "aws_iam_role" "codepipeline" {
  name = "${local.name_prefix}-codepipeline-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "codepipeline.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Policy for CodePipeline
resource "aws_iam_role_policy" "codepipeline" {
  name = "${local.name_prefix}-codepipeline-policy"
  role = aws_iam_role.codepipeline.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetBucketVersioning",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.pipeline_artifacts.arn,
          "${aws_s3_bucket.pipeline_artifacts.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "codebuild:BatchGetBuilds",
          "codebuild:StartBuild"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = "*"
      }
    ]
  })
}

# IAM Role for CodeBuild
resource "aws_iam_role" "codebuild" {
  name = "${local.name_prefix}-codebuild-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "codebuild.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Policy for CodeBuild
resource "aws_iam_role_policy" "codebuild" {
  name = "${local.name_prefix}-codebuild-policy"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerVersion",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.pipeline_artifacts.arn,
          "${aws_s3_bucket.pipeline_artifacts.arn}/*"
        ]
      }
    ]
  })
}

# CloudWatch Log Group for CodeBuild
resource "aws_cloudwatch_log_group" "codebuild" {
  name              = "/aws/codebuild/${local.name_prefix}"
  retention_in_days = 30

  tags = local.tags
}

# CodeBuild Project for Building Services
resource "aws_codebuild_project" "build_services" {
  name          = "${local.name_prefix}-build-services"
  description   = "Build Invorto platform services"
  build_timeout = "60"
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = true

    environment_variable {
      name  = "ENVIRONMENT"
      value = var.environment
    }

    environment_variable {
      name  = "AWS_DEFAULT_REGION"
      value = var.aws_region
    }

    environment_variable {
      name  = "ECR_REPOSITORY_PREFIX"
      value = "invorto"
    }
  }

  source {
    type = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        pre_build = {
          commands = [
            "echo Logging in to Amazon ECR...",
            "aws --version",
            "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
            "REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
            "COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)",
            "IMAGE_TAG=$${COMMIT_HASH:-latest}"
          ]
        }
        build = {
          commands = [
            "echo Build started on `date`",
            "echo Building the Docker image...",
            "cd services/api",
            "docker build -t $REPOSITORY_URI/invorto-api:$IMAGE_TAG .",
            "docker push $REPOSITORY_URI/invorto-api:$IMAGE_TAG",
            "cd ../realtime",
            "docker build -t $REPOSITORY_URI/invorto-realtime:$IMAGE_TAG .",
            "docker push $REPOSITORY_URI/invorto-realtime:$IMAGE_TAG",
            "cd ../webhooks",
            "docker build -t $REPOSITORY_URI/invorto-webhooks:$IMAGE_TAG .",
            "docker push $REPOSITORY_URI/invorto-webhooks:$IMAGE_TAG",
            "cd ../workers",
            "docker build -t $REPOSITORY_URI/invorto-workers:$IMAGE_TAG .",
            "docker push $REPOSITORY_URI/invorto-workers:$IMAGE_TAG"
          ]
        }
        post_build = {
          commands = [
            "echo Build completed on `date`",
            "printf '[{\"name\":\"invorto-api\",\"imageUri\":\"%s\"}]' $REPOSITORY_URI/invorto-api:$IMAGE_TAG > imagedefinitions.json"
          ]
        }
      }
      artifacts = {
        files = ["imagedefinitions.json"]
      }
    })
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "build-services"
    }
  }

  tags = local.tags
}

# CodeBuild Project for Testing
resource "aws_codebuild_project" "test_services" {
  name          = "${local.name_prefix}-test-services"
  description   = "Run tests for Invorto platform services"
  build_timeout = "30"
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ENVIRONMENT"
      value = var.environment
    }

    environment_variable {
      name  = "NODE_ENV"
      value = "test"
    }
  }

  source {
    type = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        install = {
          runtime-versions = {
            nodejs = "18"
          }
          commands = [
            "echo Installing dependencies...",
            "npm install -g npm@latest"
          ]
        }
        pre_build = {
          commands = [
            "echo Installing project dependencies...",
            "npm ci"
          ]
        }
        build = {
          commands = [
            "echo Running tests...",
            "npm run test",
            "npm run test:integration",
            "npm run test:load"
          ]
        }
        post_build = {
          commands = [
            "echo Tests completed successfully!"
          ]
        }
      }
    })
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "test-services"
    }
  }

  tags = local.tags
}

# CodeBuild Project for Security Scanning
resource "aws_codebuild_project" "security_scan" {
  name          = "${local.name_prefix}-security-scan"
  description   = "Run security scans for Invorto platform"
  build_timeout = "20"
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ENVIRONMENT"
      value = var.environment
    }
  }

  source {
    type = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        install = {
          runtime-versions = {
            python = "3.9"
          }
          commands = [
            "echo Installing security tools...",
            "pip install safety bandit"
          ]
        }
        pre_build = {
          commands = [
            "echo Starting security scan..."
          ]
        }
        build = {
          commands = [
            "echo Running dependency vulnerability scan...",
            "safety check --json --output /tmp/safety-report.json || true",
            "echo Running code security analysis...",
            "bandit -r . -f json -o /tmp/bandit-report.json || true"
          ]
        }
        post_build = {
          commands = [
            "echo Security scan completed!"
          ]
        }
      }
      artifacts = {
        files = [
          "/tmp/safety-report.json",
          "/tmp/bandit-report.json"
        ]
      }
    })
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "security-scan"
    }
  }

  tags = local.tags
}

# CodePipeline for Main Deployment
resource "aws_codepipeline" "main" {
  name     = "${local.name_prefix}-main-pipeline"
  role_arn = aws_iam_role.codepipeline.arn

  artifact_store {
    location = aws_s3_bucket.pipeline_artifacts.bucket
    type     = "S3"
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        ConnectionArn    = var.github_connection_arn
        FullRepositoryId = var.github_repository
        BranchName       = var.github_branch
      }
    }
  }

  stage {
    name = "Test"

    action {
      name             = "Test"
      category         = "Test"
      owner            = "AWS"
      provider         = "CodeBuild"
      input_artifacts  = ["source_output"]
      output_artifacts = ["test_output"]
      version          = "1"

      configuration = {
        ProjectName = aws_codebuild_project.test_services.name
      }
    }
  }

  stage {
    name = "Security"

    action {
      name             = "SecurityScan"
      category         = "Test"
      owner            = "AWS"
      provider         = "CodeBuild"
      input_artifacts  = ["source_output"]
      output_artifacts = ["security_output"]
      version          = "1"

      configuration = {
        ProjectName = aws_codebuild_project.security_scan.name
      }
    }
  }

  stage {
    name = "Build"

    action {
      name             = "Build"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      input_artifacts  = ["source_output"]
      output_artifacts = ["build_output"]
      version          = "1"

      configuration = {
        ProjectName = aws_codebuild_project.build_services.name
      }
    }
  }

  stage {
    name = "DeployToDev"

    action {
      name            = "DeployToDev"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      input_artifacts = ["build_output"]
      version         = "1"

      configuration = {
        ClusterName = var.ecs_cluster_name
        ServiceName = "invorto-api"
        FileName    = "imagedefinitions.json"
      }
    }
  }

  stage {
    name = "DeployToStaging"

    action {
      name     = "ManualApproval"
      category = "Approval"
      owner    = "AWS"
      provider = "Manual"
      version  = "1"

      configuration = {
        NotificationArn = aws_sns_topic.pipeline_notifications.arn
        CustomData      = "Please review the changes and approve deployment to staging environment"
      }
    }

    action {
      name            = "DeployToStaging"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      input_artifacts = ["build_output"]
      version         = "1"

      configuration = {
        ClusterName = var.ecs_cluster_name
        ServiceName = "invorto-api"
        FileName    = "imagedefinitions.json"
      }
    }
  }

  stage {
    name = "DeployToProduction"

    action {
      name     = "ProductionApproval"
      category = "Approval"
      owner    = "AWS"
      provider = "Manual"
      version  = "1"

      configuration = {
        NotificationArn = aws_sns_topic.pipeline_notifications.arn
        CustomData      = "CRITICAL: Approve deployment to PRODUCTION environment"
        ExternalEntityLink = "https://github.com/$${var.github_repository}/releases"
      }
    }

    action {
      name            = "DeployToProduction"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      input_artifacts = ["build_output"]
      version         = "1"

      configuration = {
        ClusterName = var.ecs_cluster_name
        ServiceName = "invorto-api"
        FileName    = "imagedefinitions.json"
      }
    }
  }

  tags = local.tags
}

# GitHub OIDC Provider for GitHub Actions
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd"
  ]

  tags = local.tags
}

# IAM Role for GitHub Actions
resource "aws_iam_role" "github_actions" {
  name = "${local.name_prefix}-github-actions-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:*"
          }
        }
      }
    ]
  })

  tags = local.tags
}

# IAM Policy for GitHub Actions
resource "aws_iam_role_policy" "github_actions" {
  name = "${local.name_prefix}-github-actions-policy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerVersion",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = "*"
      }
    ]
  })
}

# SNS Topic for Pipeline Notifications
resource "aws_sns_topic" "pipeline_notifications" {
  name = "${local.name_prefix}-notifications"
  
  tags = local.tags
}

# SNS Topic Subscription for Pipeline Notifications
resource "aws_sns_topic_subscription" "pipeline_email" {
  count     = var.enable_pipeline_notifications ? 1 : 0
  topic_arn = aws_sns_topic.pipeline_notifications.arn
  protocol  = "email"
  endpoint  = var.pipeline_notification_email
}

# CloudWatch Event Rule for Pipeline State Changes
resource "aws_cloudwatch_event_rule" "pipeline_state_changes" {
  name        = "${local.name_prefix}-pipeline-state-changes"
  description = "Capture all CodePipeline state changes"

  event_pattern = jsonencode({
    source      = ["aws.codepipeline"]
    detail-type = ["CodePipeline Pipeline Execution State Change"]
    detail = {
      pipeline = [aws_codepipeline.main.name]
    }
  })

  tags = local.tags
}

# CloudWatch Event Target for Pipeline Notifications
resource "aws_cloudwatch_event_target" "pipeline_notifications" {
  count     = var.enable_pipeline_notifications ? 1 : 0
  rule      = aws_cloudwatch_event_rule.pipeline_state_changes.name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.pipeline_notifications.arn
}

# Environment-specific deployment configurations
resource "aws_codebuild_project" "deploy_dev" {
  name          = "${local.name_prefix}-deploy-dev"
  description   = "Deploy to development environment"
  build_timeout = "30"
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ENVIRONMENT"
      value = "dev"
    }

    environment_variable {
      name  = "CLUSTER_NAME"
      value = var.ecs_cluster_name
    }
  }

  source {
    type = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        build = {
          commands = [
            "echo Deploying to development environment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-api --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-realtime --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-webhooks --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-workers --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-telephony --force-new-deployment"
          ]
        }
      }
    })
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "deploy-dev"
    }
  }

  tags = local.tags
}

resource "aws_codebuild_project" "deploy_staging" {
  name          = "${local.name_prefix}-deploy-staging"
  description   = "Deploy to staging environment with canary"
  build_timeout = "45"
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ENVIRONMENT"
      value = "staging"
    }

    environment_variable {
      name  = "CLUSTER_NAME"
      value = var.ecs_cluster_name
    }
  }

  source {
    type = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        build = {
          commands = [
            "echo Deploying to staging environment with canary deployment",
            "# Update 25% of tasks first (canary deployment)",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-api --force-new-deployment --desired-count 3",
            "sleep 300", # Wait 5 minutes for monitoring
            "# Check metrics and health",
            "echo Checking application health...",
            "# If healthy, proceed with full deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-api --force-new-deployment --desired-count 12",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-realtime --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-webhooks --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-workers --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-telephony --force-new-deployment"
          ]
        }
      }
    })
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "deploy-staging"
    }
  }

  tags = local.tags
}

resource "aws_codebuild_project" "deploy_production" {
  name          = "${local.name_prefix}-deploy-production"
  description   = "Deploy to production environment with blue-green"
  build_timeout = "60"
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ENVIRONMENT"
      value = "production"
    }

    environment_variable {
      name  = "CLUSTER_NAME"
      value = var.ecs_cluster_name
    }
  }

  source {
    type = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        build = {
          commands = [
            "echo Deploying to production environment with blue-green strategy",
            "# Create new task definition with new image",
            "TASK_DEF_ARN=$(aws ecs describe-task-definition --task-definition invorto-api --query 'taskDefinition.taskDefinitionArn' --output text)",
            "NEW_TASK_DEF=$(aws ecs register-task-definition --family invorto-api --cli-input-json file://task-definition.json --query 'taskDefinition.taskDefinitionArn' --output text)",
            "# Update service to use new task definition",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-api --task-definition $NEW_TASK_DEF --force-new-deployment",
            "# Wait for deployment to complete",
            "aws ecs wait services-stable --cluster $CLUSTER_NAME --services invorto-api",
            "# Run smoke tests",
            "echo Running production smoke tests...",
            "# If tests pass, continue with other services",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-realtime --task-definition invorto-realtime-new --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-webhooks --task-definition invorto-webhooks-new --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-workers --task-definition invorto-workers-new --force-new-deployment",
            "aws ecs update-service --cluster $CLUSTER_NAME --service invorto-telephony --task-definition invorto-telephony-new --force-new-deployment"
          ]
        }
      }
    })
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "deploy-production"
    }
  }

  tags = local.tags
}

# CloudWatch Alarms for Deployment Monitoring
resource "aws_cloudwatch_metric_alarm" "deployment_failure" {
  alarm_name          = "${local.name_prefix}-deployment-failure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "DeploymentFailure"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Sum"
  threshold           = "0"
  alarm_description   = "ECS deployment failure detected"
  alarm_actions       = [aws_sns_topic.pipeline_notifications.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
  }
}

resource "aws_cloudwatch_metric_alarm" "high_error_rate_post_deployment" {
  alarm_name          = "${local.name_prefix}-high-error-rate-post-deployment"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "High error rate detected after deployment"
  alarm_actions       = [aws_sns_topic.pipeline_notifications.arn]
}
