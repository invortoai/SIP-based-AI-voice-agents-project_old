#!/bin/bash
# User data script for Jambonz Media Gateway
# This script automatically installs and configures Jambonz on Ubuntu 22.04 LTS

set -e

# Log all output to CloudWatch
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "Starting Jambonz Media Gateway installation..."

# Update system
apt-get update
apt-get upgrade -y

# Install required packages
apt-get install -y \
    curl \
    wget \
    git \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    python3 \
    python3-pip \
    nodejs \
    npm \
    redis-tools \
    postgresql-client \
    nginx \
    certbot \
    python3-certbot-nginx

# Install Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create Jambonz user
useradd -m -s /bin/bash jambonz
usermod -aG docker jambonz

# Create Jambonz directories
mkdir -p /opt/jambonz
mkdir -p /opt/jambonz/config
mkdir -p /opt/jambonz/logs
mkdir -p /opt/jambonz/recordings
chown -R jambonz:jambonz /opt/jambonz

# Switch to Jambonz user for installation
cd /opt/jambonz

# Clone Jambonz repositories
sudo -u jambonz git clone https://github.com/jambonz/jambonz-infrastructure.git
sudo -u jambonz git clone https://github.com/jambonz/jambonz-api-server.git
sudo -u jambonz git clone https://github.com/jambonz/jambonz-media-server.git

# Create environment file
cat > /opt/jambonz/.env << EOF
# Jambonz Environment Configuration
ENVIRONMENT=$${environment}
DOMAIN=$${domain}
REDIS_URL=$${redis_url}
DB_URL=$${db_url}
SECRETS_ARN=$${secrets_arn}

# SIP Configuration
SIP_PORT=5060
RTP_START_PORT=10000
RTP_END_PORT=20000

# Media Configuration
AUDIO_CODECS=opus,pcmu,pcma
VIDEO_CODECS=h264,vp8

# Security
ENABLE_TLS=true
ENABLE_SRTP=true
ENABLE_DTLS=true

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Performance
MAX_CONCURRENT_CALLS=100
MAX_CALLS_PER_INSTANCE=50
EOF

# Create Jambonz configuration
cat > /opt/jambonz/config/jambonz.conf << EOF
# Jambonz Media Server Configuration
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 5060
context = default
allowguest = no
allowoverlap = no
bindport = 5060
srvlookup = yes
disallow = all
allow = ulaw
allow = alaw
allow = gsm
allow = g729
allow = opus
allow = h264
allow = vp8

[default]
exten => s,1,Answer()
exten => s,n,Wait(1)
exten => s,n,Playback(hello-world)
exten => s,n,Hangup()

# Include additional dialplans
#include /opt/jambonz/config/dialplans/*.conf
EOF

# Create systemd service for Jambonz
cat > /etc/systemd/system/jambonz.service << EOF
[Unit]
Description=Jambonz Media Gateway
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=jambonz
WorkingDirectory=/opt/jambonz
ExecStart=/usr/local/bin/docker-compose up
ExecStop=/usr/local/bin/docker-compose down
Restart=always
RestartSec=10
Environment=HOME=/opt/jambonz

[Install]
WantedBy=multi-user.target
EOF

# Create Docker Compose file
cat > /opt/jambonz/docker-compose.yml << EOF
version: '3.8'

services:
  jambonz-api:
    image: jambonz/jambonz-api-server:latest
    container_name: jambonz-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=${redis_url}
      - DB_URL=${db_url}
      - JWT_SECRET=${JWT_SECRET}
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
    networks:
      - jambonz

  jambonz-media:
    image: jambonz/jambonz-media-server:latest
    container_name: jambonz-media
    restart: unless-stopped
    ports:
      - "5060:5060/udp"
      - "10000-20000:10000-20000/udp"
    environment:
      - NODE_ENV=production
      - REDIS_URL=${redis_url}
      - SIP_PORT=5060
      - RTP_START_PORT=10000
      - RTP_END_PORT=20000
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
      - ./recordings:/app/recordings
    networks:
      - jambonz
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN

  nginx:
    image: nginx:alpine
    container_name: jambonz-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    networks:
      - jambonz

networks:
  jambonz:
    driver: bridge
EOF

# Create Nginx configuration
cat > /opt/jambonz/nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    upstream jambonz_api {
        server jambonz-api:3000;
    }

    server {
        listen 80;
        server_name ${domain};
        
        location / {
            return 301 https://\$server_name\$request_uri;
        }
    }

    server {
        listen 443 ssl http2;
        server_name ${domain};
        
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;
        
        location / {
            proxy_pass http://jambonz_api;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
        
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
EOF

# Create SSL directory and self-signed certificate for now
mkdir -p /opt/jambonz/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /opt/jambonz/ssl/key.pem \
    -out /opt/jambonz/ssl/cert.pem \
    -subj "/C=IN/ST=Maharashtra/L=Mumbai/O=Invorto/CN=${domain}"

# Set proper permissions
chown -R jambonz:jambonz /opt/jambonz
chmod +x /opt/jambonz/docker-compose.yml

# Enable and start Jambonz service
systemctl daemon-reload
systemctl enable jambonz.service

# Create health check script
cat > /opt/jambonz/health-check.sh << 'EOF'
#!/bin/bash
# Health check script for Jambonz

# Check if containers are running
if ! docker ps | grep -q jambonz-media; then
    echo "Jambonz media container is not running"
    exit 1
fi

if ! docker ps | grep -q jambonz-api; then
    echo "Jambonz API container is not running"
    exit 1
fi

# Check SIP port
if ! netstat -uln | grep -q :5060; then
    echo "SIP port 5060 is not listening"
    exit 1
fi

# Check API health
if ! curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "Jambonz API is not responding"
    exit 1
fi

echo "Jambonz is healthy"
exit 0
EOF

chmod +x /opt/jambonz/health-check.sh

# Create monitoring script
cat > /opt/jambonz/monitoring.sh << 'EOF'
#!/bin/bash
# Monitoring script for Jambonz

# Get container stats
echo "=== Container Status ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo -e "\n=== Resource Usage ==="
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

echo -e "\n=== SIP Connections ==="
netstat -an | grep :5060 | wc -l

echo -e "\n=== RTP Ports in Use ==="
netstat -an | grep -E ":1[0-9]{4}" | wc -l

echo -e "\n=== Disk Usage ==="
df -h /opt/jambonz

echo -e "\n=== Memory Usage ==="
free -h
EOF

chmod +x /opt/jambonz/monitoring.sh

# Create log rotation configuration
cat > /etc/logrotate.d/jambonz << EOF
/opt/jambonz/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 jambonz jambonz
    postrotate
        systemctl reload jambonz
    endscript
}
EOF

# Start Jambonz service
echo "Starting Jambonz service..."
systemctl start jambonz.service

# Wait for service to be ready
echo "Waiting for Jambonz to be ready..."
sleep 30

# Check service status
if systemctl is-active --quiet jambonz.service; then
    echo "Jambonz Media Gateway installation completed successfully!"
    echo "Service is running and enabled"
    echo "API endpoint: https://$${domain}"
    echo "SIP endpoint: $${domain}:5060"
    echo "Health check: https://$${domain}/health"
else
    echo "Jambonz service failed to start"
    systemctl status jambonz.service
    exit 1
fi

# Install CloudWatch agent for monitoring
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i amazon-cloudwatch-agent.deb

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF
{
    "agent": {
        "metrics_collection_interval": 60,
        "run_as_user": "cwagent"
    },
    "logs": {
        "logs_collected": {
            "files": {
                "collect_list": [
                    {
                        "file_path": "/opt/jambonz/logs/*.log",
                        "log_group_name": "/aws/ec2/invorto-jambonz",
                        "log_stream_name": "{instance_id}",
                        "timezone": "UTC"
                    },
                    {
                        "file_path": "/var/log/user-data.log",
                        "log_group_name": "/aws/ec2/invorto-jambonz",
                        "log_stream_name": "{instance_id}-user-data",
                        "timezone": "UTC"
                    }
                ]
            }
        }
    },
    "metrics": {
        "metrics_collected": {
            "disk": {
                "measurement": ["used_percent"],
                "metrics_collection_interval": 60,
                "resources": ["*"]
            },
            "mem": {
                "measurement": ["mem_used_percent"],
                "metrics_collection_interval": 60
            }
        }
    }
}
EOF

# Start CloudWatch agent
systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

echo "CloudWatch agent configured and started"

# Final status check
echo "=== Final Status Check ==="
systemctl status jambonz.service --no-pager -l
docker ps

echo "Jambonz Media Gateway installation and configuration completed!"
echo "Instance is ready for SIP traffic"
