# SIP AI Voice Agents — Production Deployment Runbook (AWS + ECS + OIDC)

This is a single, self‑contained, copy‑paste runnable runbook to deploy the SIP AI Voice Agents platform to AWS for the first time. It uses:

- Region: us-east-1
- Account ID: 123456789012
- Domain: example.com
- App FQDN: prod.example.com
- Route 53 Hosted Zone ID: ZABCDEFGHIJKL
- Resource prefix: sipai-prod
- VPC: 10.20.0.0/16 with 2x public + 2x private subnets and 1x NAT GW per AZ
- Execution pattern: GitHub Actions with AWS OIDC role assumption

Files referenced in CI (for OIDC role usage) are:

- [ci.yml](../.github/workflows/ci.yml:117)
- [ci.yml](../.github/workflows/ci.yml:154)
- [ci.yml](../.github/workflows/ci.yml:193)

Do not store secrets in git. Use AWS SSM Parameter Store or Secrets Manager where indicated.

-------------------------------------------------------------------------------

## 0. Overview (What you are deploying)

Services (each runs as an ECS/Fargate service behind a public ALB):

- API (sipai-prod-api): REST API for agents/calls/metrics. Health: GET /health (200).
- Realtime (sipai-prod-realtime): WebSocket gateway for realtime audio/events. Health: GET /health (200).
- Webhooks (sipai-prod-webhooks): Inbound/outbound webhooks dispatcher with HMAC helpers. Health: GET /health (200).
- Telephony (sipai-prod-telephony): Jambonz (or SIP provider) webhooks, concurrency enforcement, call control. Health: GET /health (200).

External dependencies:

- Redis (managed or self-hosted) reachable from ECS tasks (REDIS_URL)
- Optional Postgres for API (DB_URL) if used for persistence
- SIP provider (e.g., Jambonz) invoking our /telephony/* webhooks
- ACM certificate for prod.example.com, ALB, Route 53 DNS

High-level topology:

- Client (browser/SDK) → prod.example.com (ALB 80/443) → ECS services in private subnets
- ALB path routing:
  - /v1/* → API
  - /realtime/*and /v1/realtime/* → Realtime (WS)
  - /webhooks/* → Webhooks
  - /telephony/* → Telephony
- ECS tasks in private subnets; ALB in public subnets; NAT per AZ for task egress

-------------------------------------------------------------------------------

## 1. Prerequisites (One-time)

Set environment variables for this session:

```bash
export ACCOUNT_ID=123456789012
export REGION=us-east-1
export ORG=your-org
export REPO=your-repo
export DOMAIN=example.com
export APP_FQDN=prod.example.com
export HOSTED_ZONE_ID=ZABCDEFGHIJKL
export PREFIX=sipai-prod
```

Install tools:

```bash
# macOS: brew install awscli terraform jq
# Ubuntu: apt-get update && apt-get install -y awscli unzip jq
# Terraform:
TERRAFORM_VERSION=1.7.5
curl -fsSL https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip -o /tmp/terraform.zip
sudo unzip -o /tmp/terraform.zip -d /usr/local/bin
terraform version
```

-------------------------------------------------------------------------------

## 2. GitHub Actions OIDC for AWS (no static keys)

Create the OIDC provider (if not exists) with GitHub thumbprints:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1b511abead59c6ce207077c0bf0e0043b1382612 \
  --region $REGION
```

Create IAM role sipai-prod-github-oidc:
Trust policy (restrict by aud and sub to specific repo/refs/environments):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GithubActionsOIDCTrust",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:your-org/your-repo:ref:refs/heads/main",
            "repo:your-org/your-repo:ref:refs/tags/v*",
            "repo:your-org/your-repo:environment:prod"
          ]
        }
      }
    }
  ]
}
```

Create role and apply trust:

```bash
aws iam create-role \
  --role-name ${PREFIX}-github-oidc \
  --assume-role-policy-document file://trust-policy.json \
  --description "GitHub OIDC role for ${PREFIX} CI/CD" \
  --region $REGION

aws iam update-assume-role-policy \
  --role-name ${PREFIX}-github-oidc \
  --policy-document file://trust-policy.json \
  --region $REGION
```

Attach least-privilege inline policy for CI (ECR/ECS/Logs/PassRole; optional S3/DDB for TF backend):
Save as `cicd-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*" },
    { "Sid": "ECRRepoRW",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:DescribeRepositories",
        "ecr:ListImages"
      ],
      "Resource": [
        "arn:aws:ecr:us-east-1:123456789012:repository/sipai-prod-api",
        "arn:aws:ecr:us-east-1:123456789012:repository/sipai-prod-realtime",
        "arn:aws:ecr:us-east-1:123456789012:repository/sipai-prod-webhooks",
        "arn:aws:ecr:us-east-1:123456789012:repository/sipai-prod-telephony"
      ] },
    { "Sid": "ECSServiceAndTD",
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition",
        "ecs:Describe*",
        "ecs:List*",
        "ecs:UpdateService"
      ],
      "Resource": "*" },
    { "Sid": "PassExecutionAndTaskRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::123456789012:role/sipai-prod-ecsTaskExecutionRole",
        "arn:aws:iam::123456789012:role/sipai-prod-api-taskRole",
        "arn:aws:iam::123456789012:role/sipai-prod-realtime-taskRole",
        "arn:aws:iam::123456789012:role/sipai-prod-webhooks-taskRole",
        "arn:aws:iam::123456789012:role/sipai-prod-telephony-taskRole"
      ] },
    { "Sid": "CWLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ],
      "Resource": "*" },

    { "Sid": "TerraformBackendOptionalS3DDB",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::sipai-prod-terraform-state-123456789012",
        "arn:aws:s3:::sipai-prod-terraform-state-123456789012/*"
      ] },
    { "Sid": "TerraformBackendDDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:DescribeTable"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/sipai-prod-terraform-locks" }
  ]
}
```

Attach policy:

```bash
aws iam put-role-policy \
  --role-name ${PREFIX}-github-oidc \
  --policy-name ${PREFIX}-cicd-inline \
  --policy-document file://cicd-policy.json \
  --region $REGION
```

Add the role to GitHub:

- Go to Repo → Settings → Secrets and variables → Actions → New repository secret:
  - Name: AWS_OIDC_ROLE_ARN
  - Value: arn:aws:iam::123456789012:role/sipai-prod-github-oidc

CI references to this secret appear at:

- [ci.yml](../.github/workflows/ci.yml:117)
- [ci.yml](../.github/workflows/ci.yml:154)
- [ci.yml](../.github/workflows/ci.yml:193)

-------------------------------------------------------------------------------

## 3. ECR repositories (one per service) and scanning

Create repos:

```bash
aws ecr create-repository --repository-name sipai-prod-api --image-scanning-configuration scanOnPush=true --region $REGION
aws ecr create-repository --repository-name sipai-prod-realtime --image-scanning-configuration scanOnPush=true --region $REGION
aws ecr create-repository --repository-name sipai-prod-webhooks --image-scanning-configuration scanOnPush=true --region $REGION
aws ecr create-repository --repository-name sipai-prod-telephony --image-scanning-configuration scanOnPush=true --region $REGION
```

Lifecycle policy (retain last 50, remove untagged >14 days). Save as `ecr-lifecycle.json`:

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images older than 14 days",
      "selection": { "tagStatus": "untagged", "countType": "sinceImagePushed", "countUnit": "days", "countNumber": 14 },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Retain last 50 images with any tag",
      "selection": { "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 50 },
      "action": { "type": "expire" }
    }
  ]
}
```

Apply to each repo:

```bash
for r in sipai-prod-api sipai-prod-realtime sipai-prod-webhooks sipai-prod-telephony; do
  aws ecr put-lifecycle-policy --repository-name $r \
    --lifecycle-policy-text file://ecr-lifecycle.json --region $REGION
done
```

-------------------------------------------------------------------------------

## 4. Terraform remote backend (S3 + DynamoDB)

Create state bucket with security:

```bash
aws s3api create-bucket \
  --bucket sipai-prod-terraform-state-123456789012 \
  --region $REGION \
  --create-bucket-configuration LocationConstraint=$REGION

aws s3api put-bucket-versioning \
  --bucket sipai-prod-terraform-state-123456789012 \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block \
  --bucket sipai-prod-terraform-state-123456789012 \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket sipai-prod-terraform-state-123456789012 \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
```

Create DynamoDB table for state locks:

```bash
aws dynamodb create-table \
  --table-name sipai-prod-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION
```

Terraform layout (create envs/prod files):

`envs/prod/versions.tf`

```hcl
terraform {
  required_version = ">= 1.7.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}
```

`envs/prod/providers.tf`

```hcl
provider "aws" {
  region = var.region
}
```

`envs/prod/backend.tf`

```hcl
terraform {
  backend "s3" {
    bucket         = "sipai-prod-terraform-state-123456789012"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "sipai-prod-terraform-locks"
    encrypt        = true
  }
}
```

`envs/prod/variables.tf`

```hcl
variable "region" { type = string }
variable "prefix" { type = string }
variable "domain" { type = string }
variable "app_fqdn" { type = string }
variable "hosted_zone_id" { type = string }
```

`envs/prod/prod.tfvars`

```hcl
region         = "us-east-1"
prefix         = "sipai-prod"
domain         = "example.com"
app_fqdn       = "prod.example.com"
hosted_zone_id = "ZABCDEFGHIJKL"
```

`envs/prod/main.tf` (VPC, subnets, NAT, ALB, ECS cluster, IAM roles, SGs, TGs, listeners — outlines only)

```hcl
# VPC
resource "aws_vpc" "this" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${var.prefix}-vpc" }
}

# Public subnets (us-east-1a, 1b)
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.20.0.0/20"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags = { Name = "${var.prefix}-public-a" }
}
resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.20.16.0/20"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
  tags = { Name = "${var.prefix}-public-b" }
}

# Private subnets (us-east-1a, 1b)
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = "10.20.128.0/20"
  availability_zone = "us-east-1a"
  tags = { Name = "${var.prefix}-private-a" }
}
resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = "10.20.144.0/20"
  availability_zone = "us-east-1b"
  tags = { Name = "${var.prefix}-private-b" }
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.this.id
  tags = { Name = "${var.prefix}-igw" }
}

# NAT Gateways (1 per AZ)
resource "aws_eip" "nat_a" { domain = "vpc" }
resource "aws_eip" "nat_b" { domain = "vpc" }

resource "aws_nat_gateway" "nat_a" {
  allocation_id = aws_eip.nat_a.id
  subnet_id     = aws_subnet.public_a.id
  tags = { Name = "${var.prefix}-nat-a" }
}

resource "aws_nat_gateway" "nat_b" {
  allocation_id = aws_eip.nat_b.id
  subnet_id     = aws_subnet.public_b.id
  tags = { Name = "${var.prefix}-nat-b" }
}

# Route tables omitted for brevity; associate public subnets to IGW and private subnets to NATs.

# ALB
resource "aws_lb" "alb" {
  name               = "${var.prefix}-alb"
  load_balancer_type = "application"
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  security_groups    = [aws_security_group.alb.id]
  tags = { Name = "${var.prefix}-alb" }
}

# Security Groups
resource "aws_security_group" "alb" {
  name        = "${var.prefix}-alb-sg"
  description = "ALB SG"
  vpc_id      = aws_vpc.this.id
  ingress { from_port=80  to_port=80  protocol="tcp" cidr_blocks=["0.0.0.0/0"] }
  ingress { from_port=443 to_port=443 protocol="tcp" cidr_blocks=["0.0.0.0/0"] }
  egress  { from_port=0   to_port=0   protocol="-1"    cidr_blocks=["0.0.0.0/0"] }
}
resource "aws_security_group" "ecs" {
  name        = "${var.prefix}-ecs-sg"
  description = "ECS tasks SG"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 8080
    to_port         = 8085
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress  { from_port=0 to_port=0 protocol="-1" cidr_blocks=["0.0.0.0/0"] }
}

# Target groups (one per service); health path /health; 15s interval, 5s timeout
resource "aws_lb_target_group" "api" {
  name        = "${var.prefix}-tg-api"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.this.id
  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}
# Repeat TG for realtime (8081), webhooks (8082), telephony (8085)

# Listeners
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 80
  protocol          = "HTTP"
  default_action { type = "redirect" redirect { port = "443" protocol = "HTTPS" status_code = "HTTP_301" } }
}
resource "aws_acm_certificate" "cert" {
  domain_name       = var.app_fqdn
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}
# Add Route53 validation records resource (aws_route53_record) here.

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate.cert.arn
  default_action { type = "forward" target_group_arn = aws_lb_target_group.api.arn }
}

# Listener rules (path-based):
# /v1/* -> api, /realtime/*|/v1/realtime/* -> realtime, /webhooks/* -> webhooks, /telephony/* -> telephony
# Each with aws_lb_listener_rule using path_pattern conditions.

# ECS cluster
resource "aws_ecs_cluster" "this" {
  name = "${var.prefix}-cluster"
}

# IAM roles for ECS task execution and per-task roles omitted for brevity. Include execution role with ECR and CW Logs.
```

Initialize and plan:

```bash
cd envs/prod
terraform init -reconfigure
terraform plan -var-file=prod.tfvars -out=tfplan
terraform apply tfplan
```

-------------------------------------------------------------------------------

## 5. DNS and certificate (ACM + Route 53)

Request ACM cert (us-east-1) for prod.example.com:

```bash
aws acm request-certificate \
  --domain-name $APP_FQDN \
  --validation-method DNS \
  --region $REGION
```

Find validation CNAME and create in Route 53:

```bash
aws acm list-certificates --region $REGION
CERT_ARN=<copy from above>

aws acm describe-certificate --certificate-arn $CERT_ARN --region $REGION \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord"

# Create Route53 record:
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch '{
    "Changes":[
      {"Action":"UPSERT","ResourceRecordSet":{
        "Name":"<validation-name-from-describe>",
        "Type":"CNAME",
        "TTL":300,
        "ResourceRecords":[{"Value":"<validation-value-from-describe>"}]
      }}
    ]
  }'
```

Wait for validation, then create ALB A/AAAA aliases for prod.example.com:

```bash
ALB_ARN=$(aws elbv2 describe-load-balancers --names ${PREFIX}-alb --region $REGION --query "LoadBalancers[0].LoadBalancerArn" --output text)
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --region $REGION --query "LoadBalancers[0].DNSName" --output text)
ALB_HZID=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --region $REGION --query "LoadBalancers[0].CanonicalHostedZoneId" --output text)

aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"$APP_FQDN\",
        \"Type\": \"A\",
        \"AliasTarget\": {
          \"HostedZoneId\": \"$ALB_HZID\",
          \"DNSName\": \"${ALB_DNS}\",
          \"EvaluateTargetHealth\": false
        }
      }
    }, {
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"$APP_FQDN\",
        \"Type\": \"AAAA\",
        \"AliasTarget\": {
          \"HostedZoneId\": \"$ALB_HZID\",
          \"DNSName\": \"${ALB_DNS}\",
          \"EvaluateTargetHealth\": false
        }
      }
    }]
  }"
```

-------------------------------------------------------------------------------

## 6. ECS services/task definitions (sizing, deployment, circuit breaker)

Initial sizing recommendation:

- api: 512 CPU, 1024 MB, desiredCount 2, min 2, max 8
- realtime: 512 CPU, 1024 MB, desiredCount 2, min 2, max 8
- webhooks: 256 CPU, 512 MB, desiredCount 2, min 2, max 8
- telephony: 512 CPU, 1024 MB, desiredCount 2, min 2, max 8

Deployment strategy:

- DeploymentConfiguration: minimumHealthyPercent=100, maximumPercent=200 (zero-downtime)
- DeploymentCircuitBreaker: enable=true, rollback=true (auto rollback on failures)

Example ECS Service JSON fragment:

```json
{
  "serviceName": "sipai-prod-api",
  "cluster": "sipai-prod-cluster",
  "desiredCount": 2,
  "deploymentConfiguration": {
    "maximumPercent": 200,
    "minimumHealthyPercent": 100,
    "deploymentCircuitBreaker": { "enable": true, "rollback": true }
  },
  "loadBalancers": [{
    "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/sipai-prod-tg-api/xxxxxxxxxxxxxx",
    "containerName": "api",
    "containerPort": 8080
  }],
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["subnet-private-a-id", "subnet-private-b-id"],
      "securityGroups": ["sg-ecs-id"],
      "assignPublicIp": "DISABLED"
    }
  },
  "launchType": "FARGATE",
  "platformVersion": "1.4.0"
}
```

Task definition container (env + logs, using secure secrets for sensitive values):

```json
{
  "family": "sipai-prod-api-td",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/sipai-prod-ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/sipai-prod-api-taskRole",
  "containerDefinitions": [{
    "name": "api",
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/sipai-prod-api:sha-<commit>",
    "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
    "environment": [
      {"name":"PUBLIC_BASE_URL","value":"https://prod.example.com"},
      {"name":"API_BASE_URL","value":"https://prod.example.com/v1"},
      {"name":"REALTIME_WS_URL","value":"wss://prod.example.com/realtime/voice"},
      {"name":"WEBHOOK_BASE_URL","value":"https://prod.example.com/webhooks"},
      {"name":"TELEPHONY_WEBHOOK_BASE_URL","value":"https://prod.example.com/telephony"},
      {"name":"MAX_CONCURRENT_CALLS","value":"200"}
    ],
    "secrets": [
      {"name":"DB_URL","valueFrom":"arn:aws:ssm:us-east-1:123456789012:parameter/sipai-prod/DB_URL"},
      {"name":"REDIS_URL","valueFrom":"arn:aws:ssm:us-east-1:123456789012:parameter/sipai-prod/REDIS_URL"},
      {"name":"JAMBONZ_OUTCALL_URL","valueFrom":"arn:aws:ssm:us-east-1:123456789012:parameter/sipai-prod/JAMBONZ_OUTCALL_URL"},
      {"name":"JAMBONZ_TOKEN","valueFrom":"arn:aws:secretsmanager:us-east-1:123456789012:secret:sipai-prod/jambonz-token"}
    ],
    "logConfiguration": {
      "logDriver":"awslogs",
      "options": {
        "awslogs-group":"/ecs/sipai-prod/api",
        "awslogs-region":"us-east-1",
        "awslogs-stream-prefix":"ecs"
      }
    }
  }]
}
```

Repeat similar TDs for realtime (port 8081), webhooks (port 8082), and telephony (port 8085). ALB TGs and Listener rules must route accordingly. Health path for all: `/health` (200 OK), interval 15s, timeout 5s, healthy 2, unhealthy 3.

-------------------------------------------------------------------------------

## 7. Environment variables and secrets (by service)

Store all sensitive values in SSM Parameter Store or Secrets Manager.

Examples to create secrets (SSM + Secrets Manager):

```bash
aws ssm put-parameter --name "/sipai-prod/DB_URL" --type "SecureString" --value "postgresql://user:pass@db-host:5432/invorto" --overwrite --region $REGION
aws ssm put-parameter --name "/sipai-prod/REDIS_URL" --type "SecureString" --value "redis://redis-host:6379" --overwrite --region $REGION
aws ssm put-parameter --name "/sipai-prod/REALTIME_API_KEY" --type "SecureString" --value "prod-realtime-api-key" --overwrite --region $REGION
aws ssm put-parameter --name "/sipai-prod/REALTIME_WS_SECRET" --type "SecureString" --value "ws-hmac-secret" --overwrite --region $REGION
aws ssm put-parameter --name "/sipai-prod/JAMBONZ_OUTCALL_URL" --type "String" --value "https://jambonz.example/v1/Accounts/ACxxx/Calls" --overwrite --region $REGION

aws secretsmanager create-secret --name "sipai-prod/jambonz-token" --secret-string "Bearer XXXXXXXXXXXXXXXXX" --region $REGION
```

API service (sipai-prod-api):

- PUBLIC_BASE_URL=<https://prod.example.com>
- API_BASE_URL=<https://prod.example.com/v1>
- REALTIME_WS_URL=wss://prod.example.com/realtime/voice
- WEBHOOK_BASE_URL=<https://prod.example.com/webhooks>
- TELEPHONY_WEBHOOK_BASE_URL=<https://prod.example.com/telephony>
- MAX_CONCURRENT_CALLS=200
- DB_URL (SSM SecureString)
- REDIS_URL (SSM SecureString)
- OUTBOUND (optional for Jambonz originate):
  - JAMBONZ_OUTCALL_URL (SSM)
  - JAMBONZ_TOKEN (Secrets Manager)
  - JAMBONZ_APP_SID (SSM)
- Impact: Limits API-driven origination, essential for safety.

Realtime service (sipai-prod-realtime):

- PUBLIC_BASE_URL (optional for CORS checks, align domain)
- REALTIME_API_KEY (SSM — for WS subprotocol validation)
- REALTIME_WS_SECRET (SSM — optional HMAC for WS)
- REDIS_URL (SSM — timeline + webhooks queue)
- Impact: Controls WS auth and mirroring to timeline/webhooks.

Webhooks service (sipai-prod-webhooks):

- PUBLIC_BASE_URL
- REDIS_URL (SSM)
- WEBHOOK_SECRET (optional HMAC for outbound hooks)
- Impact: Deterministic CORS and queue access.

Telephony service (sipai-prod-telephony):

- PUBLIC_BASE_URL (single-domain alignment)
- REDIS_URL (SSM)
- TELEPHONY_GLOBAL_MAX_CONCURRENCY=10000
- TELEPHONY_PER_CAMPAIGN_MAX_CONCURRENCY=100
- TELEPHONY_SEMAPHORE_TTL_SEC=600
- TELEPHONY_SHARED_SECRET (optional shared token for webhook)
- JAMBONZ_WEBHOOK_SECRET (HMAC verification)
- Provider-specific (optional examples): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WEBHOOK_SECRET
- Impact: Enforces per-campaign/global concurrency; TTL cleans up leaks.

-------------------------------------------------------------------------------

## 8. CI build and release flow

- Builds per-service images and tags with git SHA and optionally semver.
- Pushes to ECR repos: sipai-prod-api, sipai-prod-realtime, sipai-prod-webhooks, sipai-prod-telephony.
- URL guard: prevents dev URL leakage.
- Terraform job: fmt/validate/plan with artifacts.
- Deployment: registers task definitions and updates ECS services.
- OIDC role is assumed in:
  - [ci.yml](../.github/workflows/ci.yml:117)
  - [ci.yml](../.github/workflows/ci.yml:154)
  - [ci.yml](../.github/workflows/ci.yml:193)
- Ensure “Run linter” fails on lint errors (no “|| true”).

-------------------------------------------------------------------------------

## 9. Observability (CloudWatch logs, alarms, dashboards)

Log groups (30-day retention):

```bash
aws logs create-log-group --log-group-name "/ecs/sipai-prod/api" --region $REGION
aws logs create-log-group --log-group-name "/ecs/sipai-prod/realtime" --region $REGION
aws logs create-log-group --log-group-name "/ecs/sipai-prod/webhooks" --region $REGION
aws logs create-log-group --log-group-name "/ecs/sipai-prod/telephony" --region $REGION

for lg in /ecs/sipai-prod/api /ecs/sipai-prod/realtime /ecs/sipai-prod/webhooks /ecs/sipai-prod/telephony; do
  aws logs put-retention-policy --log-group-name "$lg" --retention-in-days 30 --region $REGION
done
```

Alarms (examples):

- ECS service CPUUtilization > 80% (5 mins)
- ECS service MemoryUtilization > 80% (5 mins)
- ALB 5xx errors > 0 sustained
- Target group UnHealthyHostCount > 0 sustained

(Define via Terraform aws_cloudwatch_metric_alarm or AWS CLI as needed.)

-------------------------------------------------------------------------------

## 10. First deploy — chronological steps

1) Bootstrap Terraform backend:

```bash
# (run bucket and DDB commands from section 4)
cd envs/prod
terraform init -reconfigure
terraform plan -var-file=prod.tfvars -out=tfplan
terraform apply tfplan
```

2) Create ECR repos and lifecycle (section 3).

3) Configure OIDC role (section 2) and add secret AWS_OIDC_ROLE_ARN in GitHub.

4) Create SSM parameters & Secrets Manager secrets (section 7) for:

- /sipai-prod/DB_URL, /sipai-prod/REDIS_URL
- /sipai-prod/REALTIME_API_KEY, /sipai-prod/REALTIME_WS_SECRET
- /sipai-prod/JAMBONZ_OUTCALL_URL (optional)
- SecretsManager: sipai-prod/jambonz-token (optional)

5) Request ACM cert and validate DNS (section 5).

6) Create Route 53 A/AAAA alias for prod.example.com to ALB (after Terraform created ALB and TGs).

7) Push main or tag a release to trigger CI:

- CI logs should show:
  - Role assumed via OIDC
  - Docker build/push to ECR
  - Terraform fmt/validate/plan (artifacts uploaded)
  - Scanners and URL guard pass
  - ECS task definitions registered and services updated

8) Smoke test:

```bash
curl -f https://prod.example.com/health

# WS smoke (requires wscat)
wscat -c "wss://prod.example.com/realtime/voice?callId=smoke-1" -s "prod-realtime-api-key"
# Then send: {"t":"start","callId":"smoke-1","agentId":"smoke-agent"}
```

Check ECS health:

```bash
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT_ID}:targetgroup/sipai-prod-tg-api/xxxx --region $REGION

aws ecs describe-services \
  --cluster sipai-prod-cluster \
  --services sipai-prod-api sipai-prod-realtime sipai-prod-webhooks sipai-prod-telephony \
  --region $REGION

aws logs tail /ecs/sipai-prod/api --since 1h --follow --region $REGION
```

-------------------------------------------------------------------------------

## 11. Rollback procedures

- ECS circuit breaker (enabled) should auto-rollback failed deployments.
- Manual rollback to previous Task Definition:

```bash
aws ecs list-task-definitions --family-prefix sipai-prod-api --sort DESC --region $REGION | head -n 5
aws ecs update-service \
  --cluster sipai-prod-cluster \
  --service sipai-prod-api \
  --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/sipai-prod-api-td:<REV> \
  --force-new-deployment \
  --region $REGION
```

- Stop a bad deploy: set desiredCount = last known good, or pause deployment in console.
- Temporarily lock down CI: remove or narrow OIDC trust to block further deployments.
- DNS rollback: if you use a blue/green DNS cutover, revert CNAME/Alias to last known good ALB.

-------------------------------------------------------------------------------

## 12. Security

- Separate roles:
  - ecsTaskExecutionRole for pulling images/logs
  - Task roles (api/realtime/webhooks/telephony) for runtime access (e.g., SSM/Secrets)
  - OIDC CI role strictly scoped to ECR/ECS/Logs/(S3/DDB for TF)
- Permission boundaries: prefix-based resource constraints (sipai-prod-*)
- Secret rotation: telephony tokens (e.g., Jambonz/Twilio) and JWT keys; version via SSM/Secrets
- Optional: image signing (cosign) and ECR scanning
- S3 state bucket: Public Access Block on; encryption enabled; versioning and lifecycle retention

-------------------------------------------------------------------------------

## 13. Cost awareness

- Fargate task hours (CPU/memory): right-size and autoscale on CPU/memory/queue depth
- NAT gateways: hourly + data processing; consider consolidating if cost‑constrained
- ALB hours + LCU (requests, new connections): right-size target counts
- Redis/DB (if managed): choose throughput tiers carefully
- CloudWatch logs: lower retention to 7–14 days if cost sensitive

-------------------------------------------------------------------------------

## 14. Service purposes & ports (quick reference)

- API: REST; port 8080; health /health
- Realtime: WS; port 8081; health /health
- Webhooks: HTTP; port 8082; health /health
- Telephony: HTTP; port 8085; health /health

ALB routes:

- /v1/* → API TG (8080)
- /realtime/*and /v1/realtime/* → Realtime TG (8081)
- /webhooks/* → Webhooks TG (8082)
- /telephony/* → Telephony TG (8085)

-------------------------------------------------------------------------------

You now have an end‑to‑end, copy‑paste runnable path to first-time production. Use this guide verbatim with your org/repo substitutions and the exact commands and JSONs provided above.
