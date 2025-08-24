# Outputs for CI/CD Pipeline Module

output "pipeline_artifacts_bucket_name" {
  description = "Name of the S3 bucket for pipeline artifacts"
  value       = aws_s3_bucket.pipeline_artifacts.bucket
}

output "pipeline_artifacts_bucket_arn" {
  description = "ARN of the S3 bucket for pipeline artifacts"
  value       = aws_s3_bucket.pipeline_artifacts.arn
}

output "codepipeline_name" {
  description = "Name of the main CodePipeline"
  value       = aws_codepipeline.main.name
}

output "codepipeline_arn" {
  description = "ARN of the main CodePipeline"
  value       = aws_codepipeline.main.arn
}

output "build_project_name" {
  description = "Name of the CodeBuild project for building services"
  value       = aws_codebuild_project.build_services.name
}

output "test_project_name" {
  description = "Name of the CodeBuild project for testing"
  value       = aws_codebuild_project.test_services.name
}

output "security_scan_project_name" {
  description = "Name of the CodeBuild project for security scanning"
  value       = aws_codebuild_project.security_scan.name
}

output "codepipeline_role_arn" {
  description = "ARN of the CodePipeline IAM role"
  value       = aws_iam_role.codepipeline.arn
}

output "codebuild_role_arn" {
  description = "ARN of the CodeBuild IAM role"
  value       = aws_iam_role.codebuild.arn
}

output "github_actions_role_arn" {
  description = "ARN of the GitHub Actions IAM role"
  value       = aws_iam_role.github_actions.arn
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider"
  value       = aws_iam_openid_connect_provider.github.arn
}

output "pipeline_notifications_topic_arn" {
  description = "ARN of the SNS topic for pipeline notifications"
  value       = aws_sns_topic.pipeline_notifications.arn
}

output "codebuild_log_group_name" {
  description = "Name of the CloudWatch log group for CodeBuild"
  value       = aws_cloudwatch_log_group.codebuild.name
}
