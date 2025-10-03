# Update workers service with new image
$cluster = "production-invorto-cluster"
$service = "production-workers"
$taskFamily = "production-workers"
$image = "820242920118.dkr.ecr.ap-south-1.amazonaws.com/invorto-workers:latest"

# Get current task definition
$currentTaskDef = aws ecs describe-task-definition --task-definition $taskFamily --query 'taskDefinition' --output json | ConvertFrom-Json

# Update the image
$currentTaskDef.containerDefinitions[0].image = $image

# Remove fields that can't be in register-task-definition
$taskDefForRegistration = $currentTaskDef | Select-Object -Property * -ExcludeProperty taskDefinitionArn,revision,status,requiresAttributes,compatibilities,registeredAt,registeredBy

# Convert back to JSON
$taskDefJson = $taskDefForRegistration | ConvertTo-Json -Depth 10

# Register new task definition
$newTaskDefArn = aws ecs register-task-definition --cli-input-json $taskDefJson --query 'taskDefinition.taskDefinitionArn' --output text

Write-Host "New task definition ARN: $newTaskDefArn"

# Update service
aws ecs update-service --cluster $cluster --service $service --task-definition $newTaskDefArn --force-new-deployment --region ap-south-1

Write-Host "Service updated with new image"