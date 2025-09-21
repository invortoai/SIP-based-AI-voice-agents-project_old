import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import * as otelResources from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';
import { Langfuse } from 'langfuse';
import winston from 'winston';
// Langfuse client for LLM observability
let langfuseClient = null;
// Winston logger configuration
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    defaultMeta: {
        service: process.env.SERVICE_NAME || 'invorto',
        environment: process.env.NODE_ENV || 'development',
    },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        }),
    ],
});
// Add CloudWatch transport in production
if (process.env.NODE_ENV === 'production') {
    const CloudWatchTransport = require('winston-cloudwatch');
    logger.add(new CloudWatchTransport({
        logGroupName: `/aws/ecs/${process.env.SERVICE_NAME}`,
        logStreamName: process.env.HOSTNAME || 'default',
        awsRegion: process.env.AWS_REGION || 'ap-south-1',
        messageFormatter: (item) => JSON.stringify(item),
    }));
}
// Initialize OpenTelemetry
export async function initializeObservability(config) {
    // Defensive construction to avoid TS issues when Resource is type-only in some setups
    const resource = otelResources.Resource
        ? new otelResources.Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
            [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
            [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment || process.env.NODE_ENV || 'development',
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
            .catch((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Error terminating OpenTelemetry', err);
        })
            .finally(() => process.exit(0));
    });
}
// Custom metrics helper
export const customMetrics = {
    incrementCounter(name, labels) {
        const counter = metrics.getMeter('invorto').createCounter(name);
        counter.add(1, labels);
    },
    recordHistogram(name, value, labels) {
        const histogram = metrics.getMeter('invorto').createHistogram(name);
        histogram.record(value, labels);
    },
    setGauge(name, value, labels) {
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
export function createSpan(name, attributes) {
    const tracer = trace.getTracer('invorto');
    const span = tracer.startSpan(name, {
        attributes,
    });
    return span;
}
export function recordException(error, span) {
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
    trace;
    generation;
    constructor(sessionId, userId) {
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
    startGeneration(name, input, model, modelParameters) {
        if (!this.trace)
            return;
        this.generation = this.trace.generation({
            name,
            input,
            model,
            modelParameters,
            startTime: new Date(),
        });
    }
    updateGeneration(output, usage) {
        if (!this.generation)
            return;
        this.generation.update({
            output,
            usage,
            endTime: new Date(),
        });
    }
    score(name, value, comment) {
        if (!this.trace)
            return;
        this.trace.score({
            name,
            value,
            comment,
        });
    }
    event(name, metadata) {
        if (!this.trace)
            return;
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
    correlationId;
    tenantId;
    callId;
    constructor(correlationId, tenantId, callId) {
        this.correlationId = correlationId;
        this.tenantId = tenantId;
        this.callId = callId;
    }
    getMetadata() {
        return {
            correlationId: this.correlationId,
            tenantId: this.tenantId,
            callId: this.callId,
            timestamp: new Date().toISOString(),
        };
    }
    info(message, data) {
        logger.info(message, { ...this.getMetadata(), ...data });
    }
    warn(message, data) {
        logger.warn(message, { ...this.getMetadata(), ...data });
    }
    error(message, errOrData, data) {
        let err;
        let extra = data;
        if (errOrData instanceof Error) {
            err = errOrData;
        }
        else if (errOrData && typeof errOrData === 'object') {
            const obj = errOrData;
            if ('error' in obj && obj.error instanceof Error) {
                err = obj.error;
            }
            // Merge entire object into extra to preserve fields like url, attempts, data, etc.
            extra = { ...obj, ...(data || {}) };
        }
        else if (errOrData !== undefined) {
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
    debug(message, data) {
        logger.debug(message, { ...this.getMetadata(), ...data });
    }
}
// Performance monitoring
export class PerformanceMonitor {
    startTime;
    checkpoints;
    constructor() {
        this.startTime = Date.now();
        this.checkpoints = new Map();
    }
    checkpoint(name) {
        this.checkpoints.set(name, Date.now());
    }
    getMetrics() {
        const now = Date.now();
        const totalDuration = now - this.startTime;
        const checkpointMetrics = {};
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
    checks;
    constructor() {
        this.checks = new Map();
    }
    addCheck(name, check) {
        this.checks.set(name, check);
    }
    async check() {
        const results = {};
        let healthy = true;
        for (const [name, check] of this.checks) {
            try {
                results[name] = await check();
                if (!results[name])
                    healthy = false;
            }
            catch (error) {
                results[name] = false;
                healthy = false;
                logger.error(`Health check failed: ${name}`, error);
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
    logger;
    constructor(correlationId, tenantId, callId) {
        this.logger = new StructuredLogger(correlationId, tenantId, callId);
    }
    logApiKeyAccess(apiKey, action, resource, success, details) {
        this.logger.info(`API Key ${action}`, {
            apiKey: this.hashApiKey(apiKey),
            action,
            resource,
            success,
            ...details
        });
    }
    logSecurityEvent(eventType, details) {
        this.logger.warn(`Security Event: ${eventType}`, {
            eventType,
            ...details
        });
    }
    logDataAccess(resource, action, piiRedacted, details) {
        this.logger.info(`Data Access: ${action} ${resource}`, {
            resource,
            action,
            piiRedacted,
            ...details
        });
    }
    hashApiKey(apiKey) {
        // Simple hash for logging purposes (not for security)
        return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
    }
}
// Export singleton instances
export const healthChecker = new HealthChecker();
//# sourceMappingURL=observability.js.map