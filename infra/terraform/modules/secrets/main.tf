variable "environment" {
  type = string
}

resource "aws_secretsmanager_secret" "webhook" {
  name = "$${var.environment}/webhook_secret"
}

resource "aws_secretsmanager_secret" "jwt" {
  name = "$${var.environment}/jwt_public_key"
}

resource "aws_secretsmanager_secret" "deepgram" {
  name = "$${var.environment}/deepgram_api_key"
}

resource "aws_secretsmanager_secret" "openai" {
  name = "$${var.environment}/openai_api_key"
}

output "secret_arns" {
  value = {
    webhook  = aws_secretsmanager_secret.webhook.arn
    jwt      = aws_secretsmanager_secret.jwt.arn
    deepgram = aws_secretsmanager_secret.deepgram.arn
    openai   = aws_secretsmanager_secret.openai.arn
  }
}
