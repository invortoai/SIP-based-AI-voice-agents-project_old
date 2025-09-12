# Deprecated: Use the consolidated production runbook

This document has been superseded by the single, authoritative runbook:

- docs/PRODUCTION-DEPLOYMENT.md

The new runbook is end-to-end, copy-paste runnable, and includes:

- AWS OIDC setup with exact trust and CI/CD least-privilege policies (see ci.yml:117, ci.yml:154, ci.yml:193)
- Terraform backend (S3 + DynamoDB) bootstrap and full plan/apply flow
- ECS/Fargate + ALB architecture with health checks, target groups, and listener rules
- Environment variables and secrets per service (SSM/Secrets Manager)
- CI quality gates, URL guard, observability, first-deploy steps, rollback, security, and cost guidance
