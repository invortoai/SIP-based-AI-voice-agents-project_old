# Update telephony service image to latest
$taskDef = aws ecs describe-task-definition --task-definition production-telephony-ecs --region ap-south-1 --query 'taskDefinition' --output json | ConvertFrom-Json

# Update the image
$taskDef.containerDefinitions[0].image = "820242920118.dkr.ecr.ap-south-1.amazonaws.com/invorto-telephony-ecs:latest"

# Remove fields that can't be in register-task-definition
$taskDef.PSObject.Properties.Remove('taskDefinitionArn')
$taskDef.PSObject.Properties.Remove('revision')
$taskDef.PSObject.Properties.Remove('status')
$taskDef.PSObject.Properties.Remove('requiresAttributes')
$taskDef.PSObject.Properties.Remove('compatibilities')
$taskDef.PSObject.Properties.Remove('registeredAt')
$taskDef.PSObject.Properties.Remove('registeredBy')
reat
# Convert back to JSON
$taskDefJson = $taskDef | ConvertTo-Json -Depth 10

# Register new task definition
$newTaskDefArn = aws ecs register-task-definition --cli-input-json $taskDefJson --region ap-south-1 --query 'taskDefinition.taskDefinitionArn' --output text

Write-Host "New task definition ARN: $newTaskDefArn"

# Update service
aws ecs update-service --cluster production-invorto-cluster --service production-telephony-ecs --task-definition $newTaskDefArn --force-new-deployment --region ap-south-1

Write-Host "Telephony service updated with latest image"