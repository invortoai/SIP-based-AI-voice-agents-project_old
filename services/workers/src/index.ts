import Redis from "ioredis";
import type { Redis as RedisType } from "ioredis";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  initializeObservability,
  logger,
  StructuredLogger,
  customMetrics,
  healthChecker,
  createSpan,
  recordException
} from "@invorto/shared/observability";
import {
  PIIRedactor,
  getSecret
} from "@invorto/shared/security";

// Initialize observability
await initializeObservability({
  serviceName: "workers-service",
  environment: process.env.NODE_ENV || "development",
  langfuseEnabled: process.env.LANGFUSE_ENABLED === "true",
  langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
  langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
  langfuseBaseUrl: process.env.LANGFUSE_BASE_URL,
});

const structuredLogger = new StructuredLogger("workers-service");
const piiRedactor = new PIIRedactor();

const redisUrl = await getSecret("REDIS_URL") || process.env.REDIS_URL || "redis://localhost:6379";
const redis: RedisType = new (Redis as any)(redisUrl);
const s3 = new S3Client({});
const redisQ: RedisType = new (Redis as any)(redisUrl);

async function main() {
  structuredLogger.info("Worker service starting");
  customMetrics.incrementCounter("service_starts", { service: "workers" });
  
  // Add health checks
  healthChecker.addCheck("redis", async () => {
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  });
  
  healthChecker.addCheck("s3", async () => {
    try {
      await s3.send(new PutObjectCommand({ 
        Bucket: process.env.S3_BUCKET_TRANSCRIPTS || "invorto-transcripts", 
        Key: "health-check.txt", 
        Body: "health" 
      }));
      return true;
    } catch {
      return false;
    }
  });
  
  // Heartbeat monitor with observability
  setInterval(async () => {
    const span = createSpan("worker_heartbeat");
    try {
      const now = new Date().toISOString();
      const bucket = process.env.S3_BUCKET_TRANSCRIPTS || "invorto-transcripts";
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: `heartbeats/${now}.txt`, Body: now })
      );
      
      customMetrics.incrementCounter("worker_heartbeats");
      structuredLogger.debug("Heartbeat written", { timestamp: now });
    } catch (err) {
      recordException(err as Error, span);
      structuredLogger.error("Failed to write heartbeat", err  as Error);
    } finally {
      span.end();
    }
  }, 10000);

  // Webhook queue worker with observability
  (async function webhookWorker() {
    structuredLogger.info("Webhook worker started");
    
    while (true) {
      const workerSpan = createSpan("webhook_process");
      try {
        const job = await redisQ.brpop("webhooks:queue", 5);
        if (!job) continue;
        
        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          
          // Redact PII from webhook body
          if (data.body) {
            const parsedBody = JSON.parse(data.body);
            const sanitizedBody = piiRedactor.redact(parsedBody);
            data.body = JSON.stringify(sanitizedBody);
          }
          
          const res = await fetch(data.url, {
            method: "POST",
            headers: data.headers,
            body: data.body,
            signal: AbortSignal.timeout(10000) // 10 second timeout
          });
          
          if (!res.ok) {
            data.attempts = (data.attempts ?? 0) + 1;
            
            if (data.attempts < 3) {
              // Retry with exponential backoff
              const delay = Math.min(1000 * Math.pow(2, data.attempts), 30000);
              setTimeout(async () => {
                await redisQ.lpush("webhooks:queue", JSON.stringify(data));
              }, delay);
              
              customMetrics.incrementCounter("webhook_retries");
              structuredLogger.warn("Webhook failed, retrying", {
                url: data.url,
                attempts: data.attempts,
                status: res.status
              });
            } else {
              await redisQ.lpush("webhooks:dlq", JSON.stringify(data));
              customMetrics.incrementCounter("webhook_dlq");
              structuredLogger.error("Webhook moved to DLQ", {
                url: data.url,
                attempts: data.attempts
              });
            }
          } else {
            customMetrics.incrementCounter("webhook_success");
            structuredLogger.info("Webhook delivered", { url: data.url });
          }
        } catch (err) {
          // DLQ on parse or network error
          await redisQ.lpush("webhooks:dlq", raw);
          customMetrics.incrementCounter("webhook_errors");
          structuredLogger.error("Webhook processing error", err  as Error);
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Worker cycle error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();
  
  // Call analytics worker
  (async function callAnalyticsWorker() {
    structuredLogger.info("Call analytics worker started");
    
    while (true) {
      const workerSpan = createSpan("call_analytics_process");
      try {
        const job = await redisQ.brpop("analytics:queue", 5);
        if (!job) continue;
        
        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { callId, type, payload } = data;
          
          if (type === "call.completed") {
            // Process completed call analytics
            await processCallAnalytics(callId, payload);
          } else if (type === "transcription.ready") {
            // Process transcription analytics
            await processTranscriptionAnalytics(callId, payload);
          } else if (type === "cost.calculation") {
            // Process cost calculation
            await processCostCalculation(callId, payload);
          }
          
          customMetrics.incrementCounter("analytics_processed", { type });
          structuredLogger.info("Analytics processed", { callId, type });
          
        } catch (err) {
          recordException(err as Error, workerSpan);
          structuredLogger.error("Analytics processing error", { error: err, data: raw });
          // Move to DLQ after max retries
          await redisQ.lpush("analytics:dlq", raw);
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Analytics worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();
  
  // Transcription processing worker
  (async function transcriptionWorker() {
    structuredLogger.info("Transcription worker started");
    
    while (true) {
      const workerSpan = createSpan("transcription_process");
      try {
        const job = await redisQ.brpop("transcriptions:queue", 5);
        if (!job) continue;
        
        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { callId, audioUrl, language = "en-US" } = data;
          
          // Process transcription
          const result = await processTranscription(callId, audioUrl, language);
          
          // Store result
          await redis.hset(`transcription:${callId}`, {
            status: "completed",
            result: JSON.stringify(result),
            processedAt: new Date().toISOString(),
          });
          
          // Queue for analytics
          await redisQ.lpush("analytics:queue", JSON.stringify({
            callId,
            type: "transcription.ready",
            payload: result,
            timestamp: Date.now(),
          }));
          
          customMetrics.incrementCounter("transcriptions_processed");
          structuredLogger.info("Transcription processed", { callId });
          
        } catch (err) {
          recordException(err as Error, workerSpan);
          const errorData = {} as { callId?: string };
          structuredLogger.error("Transcription processing error", { error: err, callId: errorData?.callId });

          // Update status to failed
          if (errorData?.callId) {
            await redis.hset(`transcription:${errorData.callId}`, {
              status: "failed",
              error: (err as Error).message,
              failedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Transcription worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();
  
  // Cost calculation worker
  (async function costCalculationWorker() {
    structuredLogger.info("Cost calculation worker started");
    
    while (true) {
      const workerSpan = createSpan("cost_calculation_process");
      try {
        const job = await redisQ.brpop("costs:queue", 5);
        if (!job) continue;
        
        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { callId, usage } = data;
          
          // Calculate costs based on usage
          const costs = await calculateCallCosts(callId, usage);
          
          // Store costs
          await redis.hset(`costs:${callId}`, {
            costs: JSON.stringify(costs),
            calculatedAt: new Date().toISOString(),
          });
          
          // Queue for analytics
          await redisQ.lpush("analytics:queue", JSON.stringify({
            callId,
            type: "cost.calculation",
            payload: costs,
            timestamp: Date.now(),
          }));
          
          customMetrics.incrementCounter("costs_calculated");
          structuredLogger.info("Costs calculated", { callId, totalCost: costs.totalCost });
          
        } catch (err) {
          recordException(err as Error, workerSpan);
          const errorData = {} as { callId?: string };
          structuredLogger.error("Cost calculation error", { error: err, callId: errorData?.callId });
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Cost calculation worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();

  // Metrics aggregation worker
  (async function metricsAggregationWorker() {
    structuredLogger.info("Metrics aggregation worker started");

    while (true) {
      const workerSpan = createSpan("metrics_aggregation_process");
      try {
        const job = await redisQ.brpop("metrics:queue", 5);
        if (!job) continue;

        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { tenantId, timeRange, metrics } = data;

          // Aggregate metrics for the tenant
          const aggregatedMetrics = await aggregateTenantMetrics(tenantId, timeRange, metrics);

          // Store aggregated metrics
          await redis.hset(`metrics:${tenantId}:${timeRange}`, {
            data: JSON.stringify(aggregatedMetrics),
            aggregatedAt: new Date().toISOString(),
          });

          customMetrics.incrementCounter("metrics_aggregated");
          structuredLogger.info("Metrics aggregated", { tenantId, timeRange });

        } catch (err) {
          recordException(err as Error, workerSpan);
          const errorData = {} as { tenantId?: string };
          structuredLogger.error("Metrics aggregation error", { error: err, tenantId: errorData?.tenantId });
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Metrics aggregation worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();

  // Compliance worker
  (async function complianceWorker() {
    structuredLogger.info("Compliance worker started");

    while (true) {
      const workerSpan = createSpan("compliance_process");
      try {
        const job = await redisQ.brpop("compliance:queue", 5);
        if (!job) continue;

        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { tenantId, action, data: complianceData } = data;

          if (action === "gdpr_delete") {
            await processGDPRDeletion(tenantId, complianceData);
          } else if (action === "data_retention") {
            await processDataRetention(tenantId, complianceData);
          } else if (action === "audit_log") {
            await processAuditLogging(tenantId, complianceData);
          }

          customMetrics.incrementCounter("compliance_actions_processed");
          structuredLogger.info("Compliance action processed", { tenantId, action });

        } catch (err) {
          recordException(err as Error, workerSpan);
          structuredLogger.error("Compliance processing error", { error: err });
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Compliance worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();

  // Notification worker
  (async function notificationWorker() {
    structuredLogger.info("Notification worker started");

    while (true) {
      const workerSpan = createSpan("notification_process");
      try {
        const job = await redisQ.brpop("notifications:queue", 5);
        if (!job) continue;

        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { type, recipient, template, data: templateData } = data;

          if (type === "email") {
            await sendEmailNotification(recipient, template, templateData);
          } else if (type === "sms") {
            await sendSMSNotification(recipient, template, templateData);
          } else if (type === "push") {
            await sendPushNotification(recipient, template, templateData);
          }

          customMetrics.incrementCounter("notifications_sent", { type });
          structuredLogger.info("Notification sent", { type, recipient });

        } catch (err) {
          recordException(err as Error, workerSpan);
          const errorData = {} as { type?: string };
          structuredLogger.error("Notification processing error", { error: err, type: errorData?.type });
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Notification worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();

  // Quality monitoring worker
  (async function qualityMonitoringWorker() {
    structuredLogger.info("Quality monitoring worker started");

    while (true) {
      const workerSpan = createSpan("quality_monitoring_process");
      try {
        const job = await redisQ.brpop("quality:queue", 5);
        if (!job) continue;

        const [, raw] = job;
        try {
          const data = JSON.parse(raw);
          const { callId, metrics, thresholds } = data;

          // Analyze call quality
          const qualityAnalysis = await analyzeCallQuality(callId, metrics, thresholds);

          // Store quality analysis
          await redis.hset(`quality:${callId}`, {
            analysis: JSON.stringify(qualityAnalysis),
            analyzedAt: new Date().toISOString(),
          });

          // Trigger alerts if quality is poor
          if (qualityAnalysis.alerts && qualityAnalysis.alerts.length > 0) {
            await redisQ.lpush("notifications:queue", JSON.stringify({
              type: "email",
              recipient: "quality@invorto.ai",
              template: "quality_alert",
              data: { callId, alerts: qualityAnalysis.alerts }
            }));
          }

          customMetrics.incrementCounter("quality_analyses_completed");
          structuredLogger.info("Quality analysis completed", { callId, score: qualityAnalysis.overallScore });

        } catch (err) {
          recordException(err as Error, workerSpan);
          const errorData = {} as { callId?: string };
          structuredLogger.error("Quality monitoring error", { error: err, callId: errorData?.callId });
        }
      } catch (err) {
        recordException(err as Error, workerSpan);
        structuredLogger.error("Quality monitoring worker error", err  as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } finally {
        workerSpan.end();
      }
    }
  })();

  // Health check endpoint (for container health checks)
  process.on("SIGUSR1", async () => {
    const health = await healthChecker.check();
    structuredLogger.info("Health check", health);
  });
}

// Helper functions for job processing
async function processCallAnalytics(callId: string, payload: any) {
  const span = createSpan("process_call_analytics");
  try {
    // Get call timeline events
    const events = await redis.xrange(`events:${callId}`, "-", "+");
    
    // Calculate analytics
    const analytics = {
      callId,
      totalEvents: events.length,
      eventTypes: {} as Record<string, number>,
      duration: 0,
      sentiment: "neutral",
      topics: [] as string[],
      processedAt: new Date().toISOString(),
    };
    
    // Process events
    events.forEach(([, fields]) => {
      const event: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        event[String(fields[i])] = String(fields[i + 1]);
      }
      
      const kind = event.kind;
      analytics.eventTypes[kind] = (analytics.eventTypes[kind] || 0) + 1;
    });
    
    // Store analytics
    await redis.hset(`analytics:${callId}`, analytics);
    
    // Update metrics
    customMetrics.recordHistogram("call_analytics_events", analytics.totalEvents);
    
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function processTranscriptionAnalytics(callId: string, payload: any) {
  const span = createSpan("process_transcription_analytics");
  try {
    // Process transcription for insights
    const transcription = payload.transcription || "";
    const words = transcription.split(/\s+/).length;
    const sentences = transcription.split(/[.!?]+/).length;
    
    const insights = {
      callId,
      wordCount: words,
      sentenceCount: sentences,
      averageWordsPerSentence: words / Math.max(sentences, 1),
      processedAt: new Date().toISOString(),
    };
    
    // Store insights
    await redis.hset(`insights:${callId}`, insights);
    
    // Update metrics
    customMetrics.recordHistogram("transcription_word_count", words);
    
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function processCostCalculation(callId: string, payload: any) {
  const span = createSpan("process_cost_calculation");
  try {
    // Calculate total costs
    const costs = payload;
    const totalCost = Object.values(costs).reduce((sum: number, cost: unknown) => {
      return sum + (typeof cost === 'number' ? cost : 0);
    }, 0);
    
    // Store total cost
    await redis.hset(`costs:${callId}`, { totalCost });
    
    // Update metrics
    customMetrics.recordHistogram("cost_per_call", totalCost);
    
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function processTranscription(callId: string, audioUrl: string, language: string) {
  const span = createSpan("process_transcription");
  try {
    // This would integrate with Deepgram or other ASR service
    // For now, return mock result
    const result = {
      callId,
      transcription: "Mock transcription for call " + callId,
      confidence: 0.95,
      language,
      processedAt: new Date().toISOString(),
    };
    
    return result;
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function calculateCallCosts(callId: string, usage: any) {
  const span = createSpan("calculate_call_costs");
  try {
    // Calculate costs based on usage metrics
    const costs = {
      asr: (usage.asrSeconds || 0) * 0.001, // $0.001 per second
      llm: (usage.llmTokens || 0) * 0.00001, // $0.00001 per token
      tts: (usage.ttsSeconds || 0) * 0.002, // $0.002 per second
      telephony: (usage.callMinutes || 0) * 0.01, // $0.01 per minute
      storage: (usage.storageMB || 0) * 0.0001, // $0.0001 per MB
    };
    
    const totalCost = Object.values(costs).reduce((sum: number, cost: number) => sum + cost, 0);
    
    return {
      callId,
      costs,
      totalCost,
      calculatedAt: new Date().toISOString(),
    };
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

// Helper functions for new workers
async function aggregateTenantMetrics(tenantId: string, timeRange: string, metrics: any) {
  const span = createSpan("aggregate_tenant_metrics");
  try {
    // Aggregate metrics from Redis
    const keys = await redis.keys(`metrics:${tenantId}:*`);
    const aggregated = {
      tenantId,
      timeRange,
      totalCalls: 0,
      totalCost: 0,
      averageQuality: 0,
      processedAt: new Date().toISOString(),
    };

    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (data.data) {
        const metricsData = JSON.parse(data.data);
        aggregated.totalCalls += metricsData.totalCalls || 0;
        aggregated.totalCost += metricsData.totalCost || 0;
        aggregated.averageQuality += metricsData.averageQuality || 0;
      }
    }

    if (keys.length > 0) {
      aggregated.averageQuality /= keys.length;
    }

    return aggregated;
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function processGDPRDeletion(tenantId: string, data: any) {
  const span = createSpan("process_gdpr_deletion");
  try {
    const { userId, dataTypes } = data;

    // Delete user data from all relevant tables/collections
    for (const dataType of dataTypes) {
      if (dataType === "calls") {
        // Delete call records
        await redis.del(`calls:${tenantId}:${userId}`);
      } else if (dataType === "transcriptions") {
        // Delete transcription data
        await redis.del(`transcriptions:${tenantId}:${userId}`);
      }
      // Add more data types as needed
    }

    structuredLogger.info("GDPR deletion completed", { tenantId, userId, dataTypes });
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function processDataRetention(tenantId: string, data: any) {
  const span = createSpan("process_data_retention");
  try {
    const { retentionDays, dataTypes } = data;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Delete old data based on retention policy
    for (const dataType of dataTypes) {
      const keys = await redis.keys(`${dataType}:${tenantId}:*`);
      for (const key of keys) {
        const data = await redis.hgetall(key);
        if (data.createdAt && new Date(data.createdAt) < cutoffDate) {
          await redis.del(key);
        }
      }
    }

    structuredLogger.info("Data retention cleanup completed", { tenantId, retentionDays });
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function processAuditLogging(tenantId: string, data: any) {
  const span = createSpan("process_audit_logging");
  try {
    const { action, userId, resource, details } = data;

    // Store audit log entry
    await redis.hset(`audit:${tenantId}:${Date.now()}`, {
      action,
      userId,
      resource,
      details: JSON.stringify(details),
      timestamp: new Date().toISOString(),
    });

    structuredLogger.info("Audit log entry created", { tenantId, action, userId });
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function sendEmailNotification(recipient: string, template: string, data: any) {
  const span = createSpan("send_email_notification");
  try {
    // This would integrate with an email service like SendGrid, SES, etc.
    // For now, just log the notification
    structuredLogger.info("Email notification sent", { recipient, template, data });

    // Mock implementation - replace with actual email service
    console.log(`Sending email to ${recipient} with template ${template}`, data);
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function sendSMSNotification(recipient: string, template: string, data: any) {
  const span = createSpan("send_sms_notification");
  try {
    // This would integrate with an SMS service like Twilio, AWS SNS, etc.
    structuredLogger.info("SMS notification sent", { recipient, template, data });

    // Mock implementation - replace with actual SMS service
    console.log(`Sending SMS to ${recipient} with template ${template}`, data);
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function sendPushNotification(recipient: string, template: string, data: any) {
  const span = createSpan("send_push_notification");
  try {
    // This would integrate with push notification services
    structuredLogger.info("Push notification sent", { recipient, template, data });

    // Mock implementation - replace with actual push service
    console.log(`Sending push notification to ${recipient} with template ${template}`, data);
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

async function analyzeCallQuality(callId: string, metrics: any, thresholds: any) {
  const span = createSpan("analyze_call_quality");
  try {
    const analysis = {
      callId,
      overallScore: 0,
      components: {
        audioQuality: 0,
        connectionStability: 0,
        responseTime: 0,
        errorRate: 0,
      },
      alerts: [] as string[],
      recommendations: [] as string[],
    };

    // Analyze audio quality
    if (metrics.audioPacketsLost > thresholds.audioPacketsLost) {
      analysis.components.audioQuality = 0.6;
      analysis.alerts.push("High audio packet loss detected");
      analysis.recommendations.push("Check network connectivity");
    } else {
      analysis.components.audioQuality = 0.9;
    }

    // Analyze connection stability
    if (metrics.jitter > thresholds.jitter) {
      analysis.components.connectionStability = 0.7;
      analysis.alerts.push("High jitter detected");
      analysis.recommendations.push("Optimize network conditions");
    } else {
      analysis.components.connectionStability = 0.95;
    }

    // Analyze response time
    if (metrics.averageResponseTime > thresholds.averageResponseTime) {
      analysis.components.responseTime = 0.8;
      analysis.alerts.push("Slow response times detected");
      analysis.recommendations.push("Consider scaling resources");
    } else {
      analysis.components.responseTime = 0.9;
    }

    // Analyze error rate
    if (metrics.errorRate > thresholds.errorRate) {
      analysis.components.errorRate = 0.5;
      analysis.alerts.push("High error rate detected");
      analysis.recommendations.push("Investigate error sources");
    } else {
      analysis.components.errorRate = 0.95;
    }

    // Calculate overall score
    analysis.overallScore = (
      analysis.components.audioQuality * 0.3 +
      analysis.components.connectionStability * 0.3 +
      analysis.components.responseTime * 0.2 +
      analysis.components.errorRate * 0.2
    );

    return analysis;
  } catch (err) {
    recordException(err as Error, span);
    throw err;
  } finally {
    span.end();
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  structuredLogger.info("SIGTERM received, shutting down gracefully");
  redis.disconnect();
  redisQ.disconnect();
  process.exit(0);
});

main().catch((err) => {
  structuredLogger.error("Worker service failed to start", err);
  process.exit(1);
});

