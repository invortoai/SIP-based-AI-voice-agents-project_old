# AWS Deployment Guide for Invorto Voice AI Platform

## Overview
This guide provides step-by-step instructions for deploying the Invorto Voice AI Platform on AWS with enhanced security, monitoring, and reliability features.

## Architecture Overview
- **ECS Fargate**: Containerized services with auto-scaling
- **Application Load Balancer**: SSL termination and routing
- **Redis ElastiCache**: Session storage and pub/sub
- **S3**: Call recordings and logs storage
- **CloudWatch**: Monitoring and alerting
- **WAF**: Web application firewall
- **Secrets Manager**: Secure credential storage

## Prerequisites

### AWS Resources Required
- AWS Account with appropriate permissions
- Domain name (e.g., `api.invortoai.com`)
- SSL Certificate in AWS Certificate Manager
- GitHub repository with deployment pipeline

### Local Development Setup
```bash
# Install dependencies
npm install

# Build all services
npm run build

# Test locally with docker-compose
docker-compose up --build
```

## Step 1: Infrastructure Setup

### 1.1 Configure AWS CLI
```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and default region
```

### 1.2 Initialize Terraform
```bash
cd infra/terraform

# Initialize Terraform
terraform init

# Create workspace for your environment
terraform workspace select prod || terraform workspace new prod

# Plan the deployment
terraform plan -var-file="prod.tfvars"

# Apply the infrastructure
terraform apply -var-file="prod.tfvars"
```

### 1.3 Create Environment Variables File (`prod.tfvars`)
```hcl
# Basic Configuration
environment = "prod"
aws_region = "ap-south-1"
domain = "api.invortoai.com"

# VPC Configuration
vpc_cidr = "10.0.0.0/16"
availability_zones = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]

# Service Configuration
telephony_desired_count = 3
telephony_cpu = 1024
telephony_memory = 2048

# Monitoring
enable_email_alerts = true
alert_email = "alerts@yourcompany.com"
enable_slack_alerts = true
slack_webhook_url = "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

# Security
enable_waf = true
waf_rate_limit = 2000
waf_allowed_countries = ["IN", "US", "GB"]
waf_blocked_countries = ["CN", "RU"]

# Cost Management
monthly_budget = 5000
daily_cost_limit = 150
enable_cost_alerts = true
```

## Step 2: Build and Push Docker Images

### 2.1 Authenticate with ECR
```bash
# Get ECR login token
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com
```

### 2.2 Build and Push Telephony Service
```bash
# Build the telephony service
cd services/telephony
docker build -t invorto-telephony:latest .

# Tag for ECR
docker tag invorto-telephony:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/prod-telephony:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/prod-telephony:latest
```

### 2.3 Build and Push Other Services
```bash
# Repeat for other services
cd ../realtime
docker build -t invorto-realtime:latest .
docker tag invorto-realtime:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/prod-realtime:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/prod-realtime:latest

cd ../api
docker build -t invorto-api:latest .
docker tag invorto-api:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/prod-api:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/prod-api:latest
```

## Step 3: Configure Secrets

### 3.1 Create Secrets in AWS Secrets Manager
```bash
# Telephony Service Secrets
aws secretsmanager create-secret \
  --name "prod/telephony/secrets" \
  --description "Telephony service secrets" \
  --secret-string '{
    "TELEPHONY_SHARED_SECRET": "your-telephony-secret-here",
    "JAMBONZ_WEBHOOK_SECRET": "your-jambonz-webhook-secret",
    "ALLOWED_JAMBONZ_IPS": "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
  }'

# API Service Secrets
aws secretsmanager create-secret \
  --name "prod/api/secrets" \
  --description "API service secrets" \
  --secret-string '{
    "DEEPGRAM_API_KEY": "your-deepgram-key",
    "OPENAI_API_KEY": "your-openai-key",
    "JWT_SECRET": "your-jwt-secret"
  }'
```

## Step 4: Deploy Services

### 4.1 Update ECS Services
```bash
# Update telephony service
aws ecs update-service \
  --cluster prod-invorto-cluster \
  --service prod-telephony \
  --force-new-deployment \
  --desired-count 3

# Update other services similarly
aws ecs update-service \
  --cluster prod-invorto-cluster \
  --service prod-realtime \
  --force-new-deployment \
  --desired-count 5

aws ecs update-service \
  --cluster prod-invorto-cluster \
  --service prod-api \
  --force-new-deployment \
  --desired-count 3
```

### 4.2 Verify Deployment
```bash
# Check service status
aws ecs describe-services \
  --cluster prod-invorto-cluster \
  --services prod-telephony prod-realtime prod-api

# Check load balancer
aws elbv2 describe-load-balancers \
  --names prod-invorto-alb

# Check target groups
aws elbv2 describe-target-groups \
  --names prod-telephony-tg
```

## Step 5: Configure DNS

### 5.1 Update Route 53
```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names prod-invorto-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

# Create Route 53 record
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_HOSTED_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "api.invortoai.com",
        "Type": "A",
        "AliasTarget": {
          "DNSName": "'$ALB_DNS'",
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

## Step 6: Monitoring and Alerting

### 6.1 Verify CloudWatch Alarms
```bash
# List all alarms
aws cloudwatch describe-alarms \
  --alarm-name-prefix "prod-invorto"

# Check specific metrics
aws cloudwatch get-metric-statistics \
  --namespace "AWS/ECS" \
  --metric-name "CPUUtilization" \
  --dimensions Name=ClusterName,Value=prod-invorto-cluster Name=ServiceName,Value=prod-telephony \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 300 \
  --statistics Average
```

### 6.2 Test Health Endpoints
```bash
# Test telephony service health
curl -f https://api.invortoai.com/health

# Test detailed health
curl -f https://api.invortoai.com/health/detailed

# Test metrics endpoint
curl -f https://api.invortoai.com/metrics

# Test stuck calls detection
curl -f https://api.invortoai.com/calls/stuck

# Test circuit breaker status
curl -f https://api.invortoai.com/circuit-breaker/status
```

## Step 7: Security Configuration

### 7.1 Update WAF Rules
```bash
# Get WAF ARN
WAF_ARN=$(aws wafv2 list-web-acls \
  --scope REGIONAL \
  --region ap-south-1 \
  --query 'WebACLs[?Name==`prod-invorto-waf`].ARN' \
  --output text)

# Update IP sets for rate limiting
aws wafv2 update-ip-set \
  --name "prod-invorto-allowed-ips" \
  --scope REGIONAL \
  --id $WAF_ID \
  --addresses "10.0.0.0/8" "172.16.0.0/12" "192.168.0.0/16"
```

### 7.2 Configure Security Groups
```bash
# Update ALB security group to allow HTTPS
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

## Step 8: Backup and Recovery

### 8.1 Configure Automated Backups
```bash
# Enable RDS automated backups
aws rds modify-db-instance \
  --db-instance-identifier prod-invorto-db \
  --backup-retention-period 30 \
  --preferred-backup-window "03:00-04:00"

# Enable Redis snapshots
aws elasticache modify-replication-group \
  --replication-group-id prod-invorto-redis \
  --snapshot-retention-limit 7 \
  --snapshot-window "02:00-03:00"
```

### 8.2 Test Backup Recovery
```bash
# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier prod-invorto-db \
  --db-snapshot-identifier manual-backup-$(date +%Y%m%d)

# Verify S3 backup
aws s3 ls s3://prod-invorto-backups/ --recursive
```

## Step 9: Performance Optimization

### 9.1 Configure Auto Scaling
```bash
# Create auto scaling policy for telephony service
aws application-autoscaling put-scaling-policy \
  --policy-name prod-telephony-cpu-scaling \
  --policy-type TargetTrackingScaling \
  --resource-id service/prod-invorto-cluster/prod-telephony \
  --scalable-dimension ecs:service:DesiredCount \
  --service-namespace ecs \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

### 9.2 Optimize Redis Configuration
```bash
# Update Redis parameters
aws elasticache modify-cache-cluster \
  --cache-cluster-id prod-invorto-redis \
  --num-cache-nodes 2 \
  --cache-node-type cache.t3.medium
```

## Step 10: CI/CD Pipeline Setup

### 10.1 Configure CodePipeline
```bash
# Create GitHub connection (if not already done)
aws codestar-connections create-connection \
  --provider-type GitHub \
  --connection-name invorto-github-connection

# Update buildspec.yml for automated deployment
cat > buildspec.yml << EOF
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 20
  pre_build:
    commands:
      - echo "Installing dependencies..."
      - npm ci
  build:
    commands:
      - echo "Building services..."
      - npm run build
      - echo "Building Docker images..."
      - docker build -t \$REPOSITORY_URI:\$CODEBUILD_RESOLVED_SOURCE_VERSION services/telephony/
  post_build:
    commands:
      - echo "Pushing to ECR..."
      - docker push \$REPOSITORY_URI:\$CODEBUILD_RESOLVED_SOURCE_VERSION
      - echo "Creating deployment artifact..."
      - printf '[{"name":"telephony","imageUri":"%s"}]' \$REPOSITORY_URI:\$CODEBUILD_RESOLVED_SOURCE_VERSION > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
    - appspec.yml
EOF
```

## Troubleshooting

### Common Issues

1. **Service fails to start**
   ```bash
   # Check CloudWatch logs
   aws logs tail /ecs/prod/telephony --follow

   # Check ECS events
   aws ecs describe-services --cluster prod-invorto-cluster --services prod-telephony
   ```

2. **Circuit breaker activated**
   ```bash
   # Check circuit breaker status
   curl https://api.invortoai.com/circuit-breaker/status

   # Reset if needed (temporary fix)
   aws ecs update-service --cluster prod-invorto-cluster --service prod-telephony --force-new-deployment
   ```

3. **High latency or errors**
   ```bash
   # Check ALB target health
   aws elbv2 describe-target-health --target-group-arn $TARGET_GROUP_ARN

   # Check CloudWatch metrics
   aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name CPUUtilization --dimensions Name=ServiceName,Value=prod-telephony
   ```

## Security Best Practices

1. **Regular Security Audits**: Run AWS Inspector and GuardDuty regularly
2. **Access Control**: Use IAM roles with least privilege principle
3. **Network Security**: Keep security groups restrictive
4. **Data Encryption**: Ensure all data at rest and in transit is encrypted
5. **Monitoring**: Enable comprehensive logging and alerting

## Cost Optimization

1. **Auto Scaling**: Configure appropriate scaling policies
2. **Reserved Instances**: Consider RI purchases for steady workloads
3. **Storage Optimization**: Use appropriate storage classes for S3
4. **Monitoring**: Set up cost alerts and budgets

## Maintenance

### Regular Tasks
- **Weekly**: Review CloudWatch alarms and logs
- **Monthly**: Update dependencies and security patches
- **Quarterly**: Review and optimize costs
- **Annually**: Update SSL certificates and security assessments

### Emergency Procedures
1. **Service Outage**: Check ALB and ECS service status
2. **Security Incident**: Isolate affected resources and investigate
3. **Performance Issues**: Scale services or optimize configurations
4. **Data Loss**: Restore from backups following DR plan

This deployment provides a production-ready, secure, and scalable infrastructure for the Invorto Voice AI Platform with comprehensive monitoring, security, and reliability features.