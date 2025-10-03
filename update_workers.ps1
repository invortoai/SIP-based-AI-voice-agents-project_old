# Update workers service with new image and correct env vars
$CLUSTER = "production-invorto-cluster"
$SERVICE = "production-workers"
$REGION = "ap-south-1"
$IMAGE = "820242920118.dkr.ecr.ap-south-1.amazonaws.com/invorto-workers:latest"

# Get current task definition ARN
$TASK_DEF_ARN = aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION --query 'services[0].taskDefinition' --output text
Write-Host "Current task definition: $TASK_DEF_ARN"

# Get full task definition
aws ecs describe-task-definition --task-definition $TASK_DEF_ARN --region $REGION --query 'taskDefinition' --output json > current_td.json

# Update image and add env vars
$td = Get-Content current_td.json -Raw | ConvertFrom-Json

# Update image
$td.containerDefinitions[0].image = $IMAGE

# Ensure environment array exists
if (-not $td.containerDefinitions[0].environment) {
    $td.containerDefinitions[0].environment = @()
}

# Remove old env vars if they exist
$td.containerDefinitions[0].environment = $td.containerDefinitions[0].environment | Where-Object { $_.name -notin @("REDIS_URL", "S3_BUCKET_TRANSCRIPTS", "S3_BUCKET_RECORDINGS", "S3_BUCKET_DOCUMENTS") }

# Add correct env vars
$td.containerDefinitions[0].environment += [PSCustomObject]@{ name = "REDIS_URL"; value = "redis://master.production-invorto-redis.p7a5gs.aps1.cache.amazonaws.com:6379" }
$td.containerDefinitions[0].environment += [PSCustomObject]@{ name = "S3_BUCKET_TRANSCRIPTS"; value = "invorto-production-transcripts" }
$td.containerDefinitions[0].environment += [PSCustomObject]@{ name = "S3_BUCKET_RECORDINGS"; value = "invorto-production-recordings" }
$td.containerDefinitions[0].environment += [PSCustomObject]@{ name = "S3_BUCKET_DOCUMENTS"; value = "invorto-production-metrics" }

# Remove AWS fields
$td.PSObject.Properties.Remove('taskDefinitionArn')
$td.PSObject.Properties.Remove('revision')
$td.PSObject.Properties.Remove('status')
$td.PSObject.Properties.Remove('requiresAttributes')
$td.PSObject.Properties.Remove('compatibilities')
$td.PSObject.Properties.Remove('registeredAt')
$td.PSObject.Properties.Remove('registeredBy')

# Save updated task definition
$td | ConvertTo-Json -Depth 10 | Out-File updated_td.json -Encoding utf8

# Register new task definition
$NEW_TD_ARN = aws ecs register-task-definition --cli-input-json file://updated_td.json --region $REGION --query 'taskDefinition.taskDefinitionArn' --output text
Write-Host "New task definition: $NEW_TD_ARN"

# Update service
aws ecs update-service --cluster $CLUSTER --service $SERVICE --task-definition $NEW_TD_ARN --force-new-deployment --region $REGION

# Wait for deployment
aws ecs wait services-stable --cluster $CLUSTER --services $SERVICE --region $REGION

Write-Host "Workers service updated successfully!"