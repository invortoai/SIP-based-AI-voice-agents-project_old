variable "environment" {
  type = string
}

# Core secrets
resource "aws_secretsmanager_secret" "webhook" {
  name = "${var.environment}/webhook_secret"
}

resource "aws_secretsmanager_secret" "jwt" {
  name = "${var.environment}/jwt_public_key"
}

resource "aws_secretsmanager_secret" "deepgram" {
  name = "${var.environment}/deepgram_api_key"
}

resource "aws_secretsmanager_secret" "openai" {
  name = "${var.environment}/openai_api_key"
}

resource "aws_secretsmanager_secret" "jambonz" {
  name = "${var.environment}/jambonz_credentials"
}


# Supabase (DB is Supabase)
resource "aws_secretsmanager_secret" "supabase_url" {
  name = "${var.environment}/supabase_url"
}

resource "aws_secretsmanager_secret" "supabase_service_role" {
  name = "${var.environment}/supabase_service_role"
}

output "secret_arns" {
  value = {
    webhook               = aws_secretsmanager_secret.webhook.arn
    jwt                   = aws_secretsmanager_secret.jwt.arn
    deepgram              = aws_secretsmanager_secret.deepgram.arn
    openai                = aws_secretsmanager_secret.openai.arn
    jambonz               = aws_secretsmanager_secret.jambonz.arn
    supabase_url          = aws_secretsmanager_secret.supabase_url.arn
    supabase_service_role = aws_secretsmanager_secret.supabase_service_role.arn
  }
}
