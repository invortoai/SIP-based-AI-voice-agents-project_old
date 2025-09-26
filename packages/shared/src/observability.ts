import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import * as otelResources from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { trace, metrics, context, SpanStatusCode } from '@opentelemetry/api';
import { Langfuse } from 'langfuse';
import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';

// Dynamic import for CloudWatch transport (only in production)
let CloudWatchTransport: any = null;
if (process.env.NODE_ENV === 'production') {
  // Use dynamic import for conditional loading
  import('winston-cloudwatch').then((module) => {
    CloudWatchTransport = module.default || module;
  }).catch((error) => {
    console.warn('Failed to load winston-cloudwatch:', error);
  });
}

// Langfuse client for LLM observability
let langfuseClient: Langfuse | null = null;

// Winston logger configuration
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'invorto',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Add CloudWatch transport in production (async initialization)
if (process.env.NODE_ENV === 'production') {
  // Initialize CloudWatch transport asynchronously
  setImmediate(async () => {
    try {
      const cloudwatchModule = await import('winston-cloudwatch');
      const CloudWatchTransportClass = cloudwatchModule.default || cloudwatchModule;

      // Create transport with error handling
      const transport = new CloudWatchTransportClass({
        logGroupName: `/aws/ecs/${process.env.SERVICE_NAME}`,
        logStreamName: process.env.HOSTNAME || 'default',
        awsRegion: process.env.AWS_REGION || 'ap-south-1',
        messageFormatter: (item: any) => JSON.stringify(item),
      });

      // Add error handler to transport
      transport.on('error', (error: Error) => {
        logger.warn('CloudWatch transport error, falling back to console logging', {
          error: error.message,
          service: process.env.SERVICE_NAME
        });
        // Remove the failing transport
        logger.remove(transport);
      });

      // Add transport to logger
      logger.add(transport);
      logger.info('CloudWatch transport initialized');

    } catch (error) {
      logger.warn('Failed to initialize CloudWatch transport, using console logging only', {
        error: (error as Error).message,
        service: process.env.SERVICE_NAME
      });
    }
  });
}

// Initialize OpenTelemetry
export async function initializeObservability(config: {
  serviceName: string;
  environment?: string;
  langfuseEnabled?: boolean;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
}) {
  // Defensive construction to avoid TS issues when Resource is type-only in some setups
  const resource =
    (otelResources as any).Resource
      ? new (otelResources as any).Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
          [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
            config.environment || process.env.NODE_ENV || 'development',
        })
      : undefined;

  // Trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    headers: {
      'api-key': process.env.OTEL_API_KEY || '',
    },
  });

  // Metric exporter
  const metricExporter = new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics',
    headers: {
      'api-key': process.env.OTEL_API_KEY || '',
    },
  });

  // Prometheus exporter for local metrics
  const prometheusExporter = new PrometheusExporter({
    port: parseInt(process.env.METRICS_PORT || '9090'),
  });

  // Initialize SDK
  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
  });

  // Start SDK
  sdk.start();

  // Initialize Langfuse for LLM observability
  if (config.langfuseEnabled && config.langfusePublicKey && config.langfuseSecretKey) {
    langfuseClient = new Langfuse({
      publicKey: config.langfusePublicKey,
      secretKey: config.langfuseSecretKey,
      baseUrl: config.langfuseBaseUrl || 'https://cloud.langfuse.com',
    });
  }

  logger.info(`Observability initialized for service: ${config.serviceName}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => logger.info('OpenTelemetry terminated successfully'))
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Error terminating OpenTelemetry', err);
      })
      .finally(() => process.exit(0));
  });
}

// Custom metrics helper
export const customMetrics = {
  incrementCounter(name: string, labels?: Record<string, any>) {
    const counter = metrics.getMeter('invorto').createCounter(name);
    counter.add(1, labels);
  },
  
  recordHistogram(name: string, value: number, labels?: Record<string, any>) {
    const histogram = metrics.getMeter('invorto').createHistogram(name);
    histogram.record(value, labels);
  },
  
  setGauge(name: string, value: number, labels?: Record<string, any>) {
    const gauge = metrics.getMeter('invorto').createUpDownCounter(name);
    gauge.add(value, labels);
  },
  
  // Predefined metrics
  callDuration: metrics.getMeter('invorto').createHistogram('call_duration', {
    description: 'Duration of voice calls in seconds',
    unit: 's',
  }),
  
  asrLatency: metrics.getMeter('invorto').createHistogram('asr_latency', {
    description: 'ASR processing latency in milliseconds',
    unit: 'ms',
  }),
  
  ttsLatency: metrics.getMeter('invorto').createHistogram('tts_latency', {
    description: 'TTS processing latency in milliseconds',
    unit: 'ms',
  }),
  
  llmLatency: metrics.getMeter('invorto').createHistogram('llm_latency', {
    description: 'LLM response latency in milliseconds',
    unit: 'ms',
  }),
  
  webhookDelivery: metrics.getMeter('invorto').createCounter('webhook_delivery', {
    description: 'Number of webhook deliveries',
  }),
  
  errorCount: metrics.getMeter('invorto').createCounter('error_count', {
    description: 'Number of errors',
  }),
  
  activeCallsGauge: metrics.getMeter('invorto').createUpDownCounter('active_calls', {
    description: 'Number of active calls',
  }),
  
  costPerCall: metrics.getMeter('invorto').createHistogram('cost_per_call', {
    description: 'Cost per call in INR',
    unit: 'INR',
  }),
};

// Tracing helpers
export function createSpan(name: string, attributes?: Record<string, any>) {
  const tracer = trace.getTracer('invorto');
  const span = tracer.startSpan(name, {
    attributes,
  });
  return span;
}

export function recordException(error: Error, span?: any) {
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
  customMetrics.incrementCounter('errors', { type: error.name });
  logger.error('Exception recorded', { error: error.message, stack: error.stack });
}

// Langfuse integration for LLM calls
export class LangfuseObserver {
  private trace: any;
  private generation: any;

  constructor(sessionId: string, userId?: string) {
    if (!langfuseClient) {
      logger.warn('Langfuse not initialized');
      return;
    }

    this.trace = langfuseClient.trace({
      id: sessionId,
      userId,
      metadata: {
        environment: process.env.NODE_ENV,
        service: process.env.SERVICE_NAME,
      },
    });
  }

  startGeneration(
    name: string,
    input: any,
    model: string,
    modelParameters?: any
  ) {
    if (!this.trace) return;

    this.generation = this.trace.generation({
      name,
      input,
      model,
      modelParameters,
      startTime: new Date(),
    });
  }

  updateGeneration(output: any, usage?: any) {
    if (!this.generation) return;

    this.generation.update({
      output,
      usage,
      endTime: new Date(),
    });
  }

  score(name: string, value: number, comment?: string) {
    if (!this.trace) return;

    this.trace.score({
      name,
      value,
      comment,
    });
  }

  event(name: string, metadata?: any) {
    if (!this.trace) return;

    this.trace.event({
      name,
      metadata,
      timestamp: new Date(),
    });
  }

  async flush() {
    if (langfuseClient) {
      await langfuseClient.flush();
    }
  }
}

// Structured logging with correlation IDs
export class StructuredLogger {
  private correlationId: string;
  private tenantId?: string;
  private callId?: string;

  constructor(correlationId: string, tenantId?: string, callId?: string) {
    this.correlationId = correlationId;
    this.tenantId = tenantId;
    this.callId = callId;
  }

  private getMetadata() {
    return {
      correlationId: this.correlationId,
      tenantId: this.tenantId,
      callId: this.callId,
      timestamp: new Date().toISOString(),
    };
  }

  info(message: string, data?: any) {
    logger.info(message, { ...this.getMetadata(), ...data });
  }

  warn(message: string, data?: any) {
    logger.warn(message, { ...this.getMetadata(), ...data });
  }

  error(message: string, errOrData?: unknown, data?: any) {
    let err: Error | undefined;
    let extra: any = data;

    if (errOrData instanceof Error) {
      err = errOrData;
    } else if (errOrData && typeof errOrData === 'object') {
      const obj = errOrData as Record<string, any>;
      if ('error' in obj && obj.error instanceof Error) {
        err = obj.error as Error;
      }
      // Merge entire object into extra to preserve fields like url, attempts, data, etc.
      extra = { ...obj, ...(data || {}) };
    } else if (errOrData !== undefined) {
      // Primitive or other value provided as second arg; treat as extra data
      extra = { value: errOrData, ...(data || {}) };
    }

    logger.error(message, {
      ...this.getMetadata(),
      error: err?.message,
      stack: err?.stack,
      ...extra,
    });
  }

  debug(message: string, data?: any) {
    logger.debug(message, { ...this.getMetadata(), ...data });
  }
}

// Performance monitoring
export class PerformanceMonitor {
  private startTime: number;
  private checkpoints: Map<string, number>;

  constructor() {
    this.startTime = Date.now();
    this.checkpoints = new Map();
  }

  checkpoint(name: string) {
    this.checkpoints.set(name, Date.now());
  }

  getMetrics() {
    const now = Date.now();
    const totalDuration = now - this.startTime;
    const checkpointMetrics: Record<string, number> = {};

    let lastTime = this.startTime;
    for (const [name, time] of this.checkpoints) {
      checkpointMetrics[name] = time - lastTime;
      lastTime = time;
    }

    return {
      totalDuration,
      checkpoints: checkpointMetrics,
    };
  }
}

// Health check metrics
export class HealthChecker {
  private checks: Map<string, () => Promise<boolean>>;

  constructor() {
    this.checks = new Map();
  }

  addCheck(name: string, check: () => Promise<boolean>) {
    this.checks.set(name, check);
  }

  async check(): Promise<{
    ok: boolean;
    checks: Record<string, boolean>;
    timestamp: string;
  }> {
    const results: Record<string, boolean> = {};
    let healthy = true;

    for (const [name, check] of this.checks) {
      try {
        results[name] = await check();
        if (!results[name]) healthy = false;
      } catch (error) {
        results[name] = false;
        healthy = false;
        logger.error(`Health check failed: ${name}`, error as Error);
      }
    }

    return {
      ok: healthy,
      checks: results,
      timestamp: new Date().toISOString()
    };
  }
}

// Audit logging functionality
export class AuditLogger {
  private logger: StructuredLogger;
  
  constructor(correlationId: string, tenantId?: string, callId?: string) {
    this.logger = new StructuredLogger(correlationId, tenantId, callId);
  }
  
  logApiKeyAccess(apiKey: string, action: string, resource: string, success: boolean, details?: any) {
    this.logger.info(`API Key ${action}`, {
      apiKey: this.hashApiKey(apiKey),
      action,
      resource,
      success,
      ...details
    });
  }
  
  logSecurityEvent(eventType: string, details?: any) {
    this.logger.warn(`Security Event: ${eventType}`, {
      eventType,
      ...details
    });
  }
  
  logDataAccess(resource: string, action: string, piiRedacted: boolean, details?: any) {
    this.logger.info(`Data Access: ${action} ${resource}`, {
      resource,
      action,
      piiRedacted,
      ...details
    });
  }
  
  private hashApiKey(apiKey: string): string {
    // Simple hash for logging purposes (not for security)
    return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
  }
}

// Export singleton instances
export const healthChecker = new HealthChecker();