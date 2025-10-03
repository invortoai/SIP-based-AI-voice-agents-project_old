// Simplified observability for lean builds - minimal implementation
import winston from 'winston';

// Simple logger configuration without external dependencies
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

// Simplified observability initialization
export async function initializeObservability(config: {
  serviceName: string;
  environment?: string;
  langfuseEnabled?: boolean;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
}) {
  logger.info(`Observability initialized for service: ${config.serviceName}`);
}

// Simplified metrics helper
export const customMetrics = {
  incrementCounter(name: string, labels?: Record<string, any>) {
    logger.info(`Counter: ${name}`, labels);
  },

  recordHistogram(name: string, value: number, labels?: Record<string, any>) {
    logger.info(`Histogram: ${name} = ${value}`, labels);
  },

  setGauge(name: string, value: number, labels?: Record<string, any>) {
    logger.info(`Gauge: ${name} = ${value}`, labels);
  },
};

// Simplified tracing helpers
export function createSpan(name: string, attributes?: Record<string, any>) {
  return {
    end() {},
    recordException(error: Error) {
      logger.error(`Span exception in ${name}`, { error: error.message, stack: error.stack });
    },
    setStatus(status: any) {},
  };
}

export function recordException(error: Error, span?: any) {
  logger.error('Exception recorded', { error: error.message, stack: error.stack });
}

// Simplified structured logging
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
      extra = { ...obj, ...(data || {}) };
    } else if (errOrData !== undefined) {
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

// Simplified performance monitoring
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

// Simplified health checker
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

// Export singleton instances
export const healthChecker = new HealthChecker();