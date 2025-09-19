variable "environment" { type = string }
variable "bucket_prefix" { type = string }

resource "aws_s3_bucket" "recordings" { bucket = "${var.bucket_prefix}-${var.environment}-recordings" }
resource "aws_s3_bucket" "transcripts" { bucket = "${var.bucket_prefix}-${var.environment}-transcripts" }
resource "aws_s3_bucket" "metrics" { bucket = "${var.bucket_prefix}-${var.environment}-metrics" }

# S3 Bucket Lifecycle Policies for Data Retention
resource "aws_s3_bucket_lifecycle_configuration" "recordings_lifecycle" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    id     = "DeleteOldRecordings"
    status = "Enabled"

    expiration {
      days = 90
    }

    filter {
      prefix = ""
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "transcripts_lifecycle" {
  bucket = aws_s3_bucket.transcripts.id

  rule {
    id     = "DeleteOldTranscripts"
    status = "Enabled"

    expiration {
      days = 180
    }

    filter {
      prefix = ""
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "metrics_lifecycle" {
  bucket = aws_s3_bucket.metrics.id

  rule {
    id     = "DeleteOldMetrics"
    status = "Enabled"

    expiration {
      days = 365
    }

    filter {
      prefix = ""
    }
  }
}

output "bucket_names" {
  value = {
    recordings  = aws_s3_bucket.recordings.bucket,
    transcripts = aws_s3_bucket.transcripts.bucket,
    metrics     = aws_s3_bucket.metrics.bucket,
  }
}
