import winston from 'winston';
export declare const logger: winston.Logger;
export declare function initializeObservability(config: {
    serviceName: string;
    environment?: string;
    langfuseEnabled?: boolean;
    langfusePublicKey?: string;
    langfuseSecretKey?: string;
    langfuseBaseUrl?: string;
}): Promise<void>;
export declare const customMetrics: {
    incrementCounter(name: string, labels?: Record<string, any>): void;
    recordHistogram(name: string, value: number, labels?: Record<string, any>): void;
    setGauge(name: string, value: number, labels?: Record<string, any>): void;
    callDuration: import("@opentelemetry/api").Histogram<import("@opentelemetry/api").Attributes>;
    asrLatency: import("@opentelemetry/api").Histogram<import("@opentelemetry/api").Attributes>;
    ttsLatency: import("@opentelemetry/api").Histogram<import("@opentelemetry/api").Attributes>;
    llmLatency: import("@opentelemetry/api").Histogram<import("@opentelemetry/api").Attributes>;
    webhookDelivery: import("@opentelemetry/api").Counter<import("@opentelemetry/api").Attributes>;
    errorCount: import("@opentelemetry/api").Counter<import("@opentelemetry/api").Attributes>;
    activeCallsGauge: import("@opentelemetry/api").UpDownCounter<import("@opentelemetry/api").Attributes>;
    costPerCall: import("@opentelemetry/api").Histogram<import("@opentelemetry/api").Attributes>;
};
export declare function createSpan(name: string, attributes?: Record<string, any>): import("@opentelemetry/api").Span;
export declare function recordException(error: Error, span?: any): void;
export declare class LangfuseObserver {
    private trace;
    private generation;
    constructor(sessionId: string, userId?: string);
    startGeneration(name: string, input: any, model: string, modelParameters?: any): void;
    updateGeneration(output: any, usage?: any): void;
    score(name: string, value: number, comment?: string): void;
    event(name: string, metadata?: any): void;
    flush(): Promise<void>;
}
export declare class StructuredLogger {
    private correlationId;
    private tenantId?;
    private callId?;
    constructor(correlationId: string, tenantId?: string, callId?: string);
    private getMetadata;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, errOrData?: unknown, data?: any): void;
    debug(message: string, data?: any): void;
}
export declare class PerformanceMonitor {
    private startTime;
    private checkpoints;
    constructor();
    checkpoint(name: string): void;
    getMetrics(): {
        totalDuration: number;
        checkpoints: Record<string, number>;
    };
}
export declare class HealthChecker {
    private checks;
    constructor();
    addCheck(name: string, check: () => Promise<boolean>): void;
    check(): Promise<{
        ok: boolean;
        checks: Record<string, boolean>;
        timestamp: string;
    }>;
}
export declare class AuditLogger {
    private logger;
    constructor(correlationId: string, tenantId?: string, callId?: string);
    logApiKeyAccess(apiKey: string, action: string, resource: string, success: boolean, details?: any): void;
    logSecurityEvent(eventType: string, details?: any): void;
    logDataAccess(resource: string, action: string, piiRedacted: boolean, details?: any): void;
    private hashApiKey;
}
export declare const healthChecker: HealthChecker;
