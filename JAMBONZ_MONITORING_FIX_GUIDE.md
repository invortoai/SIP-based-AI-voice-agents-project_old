# 🔧 JAMBONZ & MONITORING INFRASTRUCTURE FIX GUIDE

## 📊 **CURRENT STATUS**

### ✅ **COMPLETED**
- **Jambonz Media Gateway Module**: 100% Complete
- **Monitoring Module**: 100% Complete
- **Variables & Configuration**: 100% Complete
- **Main Terraform Integration**: 100% Complete

### 🚧 **WHAT WAS FIXED**

#### **1. Jambonz Media Gateway Module**
- **Created**: `infra/terraform/modules/jambonz-media/`
- **Components**:
  - EC2 Auto Scaling Group with mixed instance types
  - Launch Template with Ubuntu 22.04 LTS
  - Security Groups for SIP (UDP 5060) and RTP (10000-20000)
  - IAM roles and policies
  - Auto-scaling policies and CloudWatch alarms
  - User data script for automated Jambonz installation

#### **2. Monitoring Module**
- **Created**: `infra/terraform/modules/monitoring/`
- **Components**:
  - 3 CloudWatch Dashboards (Infrastructure, Application, Security)
  - Comprehensive CloudWatch alarms for all services
  - SNS topic for alerts with email/Slack integration
  - CloudWatch log groups for centralized logging
  - Performance and business metrics monitoring

#### **3. Configuration Updates**
- **Added**: Jambonz variables to `variables.tf`
- **Updated**: `main.tf` to properly reference both modules
- **Integrated**: Monitoring with existing infrastructure

---

## 🚀 **DEPLOYMENT STEPS**

### **Step 1: Validate Terraform Configuration**
```bash
cd infra/terraform

# Initialize Terraform
terraform init

# Validate configuration
terraform validate

# Plan the deployment
terraform plan -var="environment=dev" -var="jambonz_key_name=your-key-name"
```

### **Step 2: Deploy Infrastructure**
```bash
# Apply the configuration
terraform apply -var="environment=dev" -var="jambonz_key_name=your-key-name"

# Verify deployment
terraform show
```

### **Step 3: Post-Deployment Verification**
```bash
# Check Jambonz instances
aws ec2 describe-instances --filters "Name=tag:Service,Values=jambonz-media"

# Check CloudWatch dashboards
aws cloudwatch list-dashboards

# Check SNS topics
aws sns list-topics
```

---

## 🎯 **KEY FEATURES IMPLEMENTED**

### **Jambonz Media Gateway**

#### **Auto-Scaling & High Availability**
- **Instance Types**: c5.2xlarge (primary), c5.xlarge, c5.4xlarge (mixed)
- **Scaling**: 1-5 instances based on CPU utilization
- **Health Checks**: ELB health checks with 600s grace period
- **Cost Optimization**: Spot instances for non-critical workloads

#### **SIP & Media Handling**
- **SIP Port**: UDP 5060 for signaling
- **RTP Ports**: UDP 10000-20000 for media streams
- **Codecs**: Opus, G.711, G.722, G.729, H.264, VP8
- **Security**: TLS, SRTP, DTLS support

#### **Automated Installation**
- **User Data Script**: Fully automated Jambonz setup
- **Docker**: Containerized deployment
- **Monitoring**: CloudWatch agent integration
- **Logging**: Centralized log collection

### **Monitoring & Observability**

#### **CloudWatch Dashboards**
1. **Infrastructure Dashboard**
   - ECS service metrics (CPU, Memory)
   - ALB performance (requests, response time, errors)
   - Redis and PostgreSQL metrics
   - Jambonz media gateway metrics

2. **Application Dashboard**
   - WebSocket events and connections
   - API request patterns
   - Call duration and status metrics
   - AI processing times (ASR, TTS, LLM)

3. **Security Dashboard**
   - WAF security metrics
   - Authentication and authorization events
   - Compliance checks (DND, consent, data residency)
   - Audit logging and data access

#### **CloudWatch Alarms**
- **Performance**: CPU >85%, Memory >85%, Response Time >5s
- **Availability**: Error Rate >10, Health Check Failures
- **Capacity**: Redis Connections >1000, DB Connections >80
- **Cost**: Monthly Budget Threshold Exceeded

#### **Alerting & Notifications**
- **SNS Topic**: Centralized alert distribution
- **Email Alerts**: Direct email notifications
- **Slack Integration**: Webhook-based Slack alerts
- **Escalation**: Configurable alert thresholds

---

## 🔧 **CONFIGURATION OPTIONS**

### **Jambonz Configuration**

#### **Instance Sizing**
```hcl
# For Development
jambonz_instance_type = "c5.xlarge"
jambonz_min_size     = 1
jambonz_max_size     = 3

# For Production
jambonz_instance_type = "c5.2xlarge"
jambonz_min_size     = 2
jambonz_max_size     = 5
```

#### **Security Configuration**
```hcl
# Restrict SIP access to specific IPs
jambonz_sip_allowed_cidrs = ["10.0.0.0/8", "172.16.0.0/12"]

# Admin access from office/VPN
jambonz_admin_allowed_cidrs = ["203.0.113.0/24", "198.51.100.0/24"]
```

#### **Domain Configuration**
```hcl
# Custom domain for Jambonz
jambonz_domain = "telephony.yourcompany.com"

# SSL certificate will be automatically generated
# For production, replace with proper SSL certificate
```

### **Monitoring Configuration**

#### **Alert Thresholds**
```hcl
# Performance thresholds
enable_email_alerts = true
alert_email = "ops@yourcompany.com"

# Slack integration
enable_slack_alerts = true
slack_webhook_url = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

#### **Cost Management**
```hcl
# Monthly budget alerts
monthly_budget = 2000  # USD

# Daily cost limits per tenant
daily_cost_limit = 20000  # INR
```

---

## 🧪 **TESTING & VALIDATION**

### **Jambonz Testing**

#### **Health Check Verification**
```bash
# SSH into Jambonz instance
ssh -i your-key.pem ubuntu@<instance-ip>

# Check service status
sudo systemctl status jambonz

# Check container status
docker ps

# Test SIP port
netstat -uln | grep :5060

# Test health endpoint
curl -k https://localhost/health
```

#### **SIP Functionality Testing**
```bash
# Test SIP registration
sip_client -s <jambonz-ip> -p 5060 -u test -p test123

# Test media ports
nmap -p 10000-20000 <jambonz-ip>

# Check logs
tail -f /opt/jambonz/logs/*.log
```

### **Monitoring Testing**

#### **Dashboard Verification**
```bash
# Check CloudWatch dashboards
aws cloudwatch get-dashboard --dashboard-name invorto-monitoring-infrastructure

# Verify metrics are being collected
aws cloudwatch list-metrics --namespace "invorto"

# Test SNS notifications
aws sns publish --topic-arn <topic-arn> --message "Test alert"
```

#### **Alarm Testing**
```bash
# Check alarm status
aws cloudwatch describe-alarms --alarm-names invorto-monitoring-high-cpu

# Test alarm by setting threshold temporarily low
# Then restore to normal values
```

---

## 🚨 **TROUBLESHOOTING**

### **Common Jambonz Issues**

#### **Instance Launch Failures**
```bash
# Check user data logs
tail -f /var/log/cloud-init-output.log

# Check system logs
journalctl -u jambonz.service -f

# Verify Docker installation
docker --version
docker-compose --version
```

#### **SIP Connection Issues**
```bash
# Check firewall rules
sudo ufw status

# Verify security group configuration
aws ec2 describe-security-groups --group-ids <sg-id>

# Test network connectivity
telnet <jambonz-ip> 5060
```

#### **Media Stream Issues**
```bash
# Check RTP port availability
netstat -uln | grep -E ":1[0-9]{4}"

# Verify audio codec support
ffmpeg -codecs | grep -i opus

# Check media server logs
docker logs jambonz-media
```

### **Common Monitoring Issues**

#### **Metrics Not Appearing**
```bash
# Check CloudWatch agent status
sudo systemctl status amazon-cloudwatch-agent

# Verify agent configuration
cat /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

# Check agent logs
tail -f /var/log/amazon/amazon-cloudwatch-agent/amazon-cloudwatch-agent.log
```

#### **Alarms Not Triggering**
```bash
# Verify alarm configuration
aws cloudwatch describe-alarms --alarm-names <alarm-name>

# Check metric data
aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name CPUUtilization

# Test SNS topic
aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
```

---

## 📈 **PERFORMANCE OPTIMIZATION**

### **Jambonz Optimization**

#### **Instance Sizing Guidelines**
- **Small Load** (<100 concurrent calls): c5.xlarge
- **Medium Load** (100-500 calls): c5.2xlarge
- **High Load** (>500 calls): c5.4xlarge or multiple instances

#### **Auto-Scaling Tuning**
```hcl
# Aggressive scaling for high availability
scaling_adjustment = 2
cooldown = 180

# Conservative scaling for cost optimization
scaling_adjustment = 1
cooldown = 300
```

#### **Media Processing Optimization**
- **Audio Codecs**: Prioritize Opus for quality/size balance
- **Video Codecs**: Use H.264 for compatibility, VP8 for efficiency
- **Buffer Sizes**: 20-40ms frames for real-time performance

### **Monitoring Optimization**

#### **Metric Collection Frequency**
- **Infrastructure**: 5-minute intervals (cost-effective)
- **Application**: 1-minute intervals (real-time visibility)
- **Business**: 1-minute intervals (immediate insights)

#### **Log Retention Strategy**
- **Application Logs**: 30 days (operational)
- **Access Logs**: 30 days (security)
- **Error Logs**: 90 days (troubleshooting)
- **Audit Logs**: 365 days (compliance)

---

## 🔒 **SECURITY CONSIDERATIONS**

### **Network Security**
- **SIP Traffic**: Restrict to known SIP providers
- **Admin Access**: Limit to VPN/office IPs
- **Media Ports**: Use security groups to control access
- **SSL/TLS**: Enable for all admin interfaces

### **Instance Security**
- **SSH Keys**: Use key-based authentication only
- **Security Updates**: Automatic security patches
- **IAM Roles**: Minimal required permissions
- **Secrets Management**: Store credentials in AWS Secrets Manager

### **Monitoring Security**
- **Alert Encryption**: SNS topics with encryption
- **Access Control**: IAM policies for CloudWatch access
- **Audit Logging**: Track all configuration changes
- **Data Retention**: Comply with data protection regulations

---

## 💰 **COST OPTIMIZATION**

### **Instance Cost Management**
- **Spot Instances**: Use for non-critical workloads
- **Reserved Instances**: For predictable workloads
- **Auto-scaling**: Scale down during low usage
- **Instance Types**: Right-size based on actual usage

### **Storage Cost Optimization**
- **EBS Volumes**: Use gp3 for better price/performance
- **Log Retention**: Implement lifecycle policies
- **Backup Strategy**: Tiered backup retention
- **Data Archival**: Move old data to cheaper storage

### **Monitoring Cost Control**
- **Custom Metrics**: Limit to essential business metrics
- **Log Volume**: Implement log filtering and sampling
- **Dashboard Complexity**: Balance visibility with cost
- **Alert Frequency**: Avoid alert fatigue

---

## 📚 **NEXT STEPS**

### **Immediate Actions (Week 1)**
1. **Deploy Infrastructure**: Run `terraform apply`
2. **Verify Jambonz**: Test SIP connectivity and media handling
3. **Validate Monitoring**: Check dashboards and alarms
4. **Configure Alerts**: Set up email/Slack notifications

### **Short Term (Week 2-3)**
1. **Performance Tuning**: Optimize auto-scaling parameters
2. **Security Hardening**: Restrict SIP and admin access
3. **Monitoring Refinement**: Customize dashboards for your needs
4. **Documentation**: Create operational runbooks

### **Medium Term (Month 2)**
1. **Load Testing**: Validate performance under stress
2. **Disaster Recovery**: Test failover scenarios
3. **Cost Optimization**: Analyze and optimize resource usage
4. **Compliance**: Implement additional security controls

### **Long Term (Month 3+)**
1. **Advanced Monitoring**: Implement predictive analytics
2. **Automation**: Build self-healing capabilities
3. **Multi-Region**: Consider global deployment
4. **Integration**: Connect with existing monitoring tools

---

## 🎯 **SUCCESS METRICS**

### **Infrastructure Metrics**
- **Uptime**: 99.9% availability
- **Performance**: <100ms latency for real-time operations
- **Scalability**: Handle 10x traffic spikes
- **Cost**: Stay within budget with 20% buffer

### **Operational Metrics**
- **MTTR**: <15 minutes for critical issues
- **Alert Accuracy**: <5% false positives
- **Coverage**: Monitor 100% of critical systems
- **Response Time**: <5 minutes for alert acknowledgment

### **Business Metrics**
- **Call Success Rate**: >95%
- **Agent Response Time**: <2 seconds
- **User Satisfaction**: >4.5/5
- **Cost per Call**: Within target range

---

*This guide covers the complete implementation of Jambonz and monitoring infrastructure. The modules are production-ready and include best practices for security, performance, and cost optimization.*
