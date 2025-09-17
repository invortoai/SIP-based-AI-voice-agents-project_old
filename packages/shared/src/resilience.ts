import { EventEmitter } from 'events';

/**
 * Circuit Breaker pattern implementation for provider failover
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
  errorThresholdPercentage?: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private requestCount: number = 0;
  private errorCount: number = 0;
  private nextAttempt: number = 0;
  private options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions = {}) {
    super();
    this.options = {
      failureThreshold: options.failureThreshold || 5,
      successThreshold: options.successThreshold || 2,
      timeout: options.timeout || 10000,
      resetTimeout: options.resetTimeout || 30000,
      volumeThreshold: options.volumeThreshold || 10,
      errorThresholdPercentage: options.errorThresholdPercentage || 50,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = CircuitState.HALF_OPEN;
      this.emit('half-open');
    }

    this.requestCount++;

    try {
      const result = await this.callWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private async callWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Circuit breaker timeout'));
      }, this.options.timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.successCount = 0;
        this.state = CircuitState.CLOSED;
        this.emit('closed');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.errorCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      this.emit('open');
      return;
    }

    if (this.state === CircuitState.CLOSED) {
      const errorPercentage = (this.errorCount / this.requestCount) * 100;
      
      if (
        this.failureCount >= this.options.failureThreshold ||
        (this.requestCount >= this.options.volumeThreshold &&
          errorPercentage >= this.options.errorThresholdPercentage)
      ) {
        this.state = CircuitState.OPEN;
        this.nextAttempt = Date.now() + this.options.resetTimeout;
        this.emit('open');
      }
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.requestCount = 0;
    this.errorCount = 0;
    this.lastFailureTime = 0;
    this.nextAttempt = 0;
    this.emit('reset');
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorPercentage: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,
    };
  }
}

/**
 * Provider Failover Manager
 */
export interface Provider {
  name: string;
  priority: number;
  execute: <T>(...args: any[]) => Promise<T>;
  healthCheck?: () => Promise<boolean>;
}

export class FailoverManager extends EventEmitter {
  private providers: Provider[] = [];
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private currentProviderIndex: number = 0;
  private lastHealthCheck: Map<string, number> = new Map();
  private healthCheckInterval: number = 60000; // 1 minute

  constructor(providers: Provider[], circuitBreakerOptions?: CircuitBreakerOptions) {
    super();
    this.providers = providers.sort((a, b) => a.priority - b.priority);
    
    // Create circuit breaker for each provider
    for (const provider of this.providers) {
      this.circuitBreakers.set(provider.name, new CircuitBreaker(circuitBreakerOptions));
    }
  }

  async execute<T>(...args: any[]): Promise<T> {
    const errors: Array<{ provider: string; error: any }> = [];

    for (let i = 0; i < this.providers.length; i++) {
      const providerIndex = (this.currentProviderIndex + i) % this.providers.length;
      const provider = this.providers[providerIndex];
      const circuitBreaker = this.circuitBreakers.get(provider.name)!;

      // Check if provider is healthy
      if (!(await this.isProviderHealthy(provider))) {
        errors.push({ provider: provider.name, error: 'Provider unhealthy' });
        continue;
      }

      try {
        const result = await circuitBreaker.execute(() => provider.execute<T>(...args));
        
        // Success - update current provider if different
        if (providerIndex !== this.currentProviderIndex) {
          this.currentProviderIndex = providerIndex;
          this.emit('failover', { from: this.providers[this.currentProviderIndex].name, to: provider.name });
        }
        
        return result;
      } catch (error) {
        errors.push({ provider: provider.name, error });
        this.emit('provider-error', { provider: provider.name, error });
        
        // Try next provider
        continue;
      }
    }

    // All providers failed
    this.emit('all-providers-failed', errors);
    throw new Error(`All providers failed: ${JSON.stringify(errors)}`);
  }

  private async isProviderHealthy(provider: Provider): Promise<boolean> {
    if (!provider.healthCheck) {
      return true; // No health check defined, assume healthy
    }

    const lastCheck = this.lastHealthCheck.get(provider.name) || 0;
    const now = Date.now();

    // Use cached health check result if recent
    if (now - lastCheck < this.healthCheckInterval) {
      return true;
    }

    try {
      const isHealthy = await provider.healthCheck();
      this.lastHealthCheck.set(provider.name, now);
      
      if (!isHealthy) {
        this.emit('provider-unhealthy', provider.name);
      }
      
      return isHealthy;
    } catch (error) {
      this.emit('health-check-failed', { provider: provider.name, error });
      return false;
    }
  }

  getProviderStats(providerName: string) {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    return circuitBreaker ? circuitBreaker.getStats() : null;
  }

  getAllStats() {
    const stats: Record<string, any> = {};
    for (const [name, breaker] of this.circuitBreakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  resetProvider(providerName: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      circuitBreaker.reset();
    }
  }

  resetAll(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
  }
}

/**
 * ASR Provider Failover
 */
export class ASRFailover extends FailoverManager {
  constructor() {
    const providers: Provider[] = [
      {
        name: 'deepgram',
        priority: 1,
        execute: async (_audio: Uint8Array) => {
          throw new Error('ASR provider not wired at shared layer. Implement in service.');
        },
      },
    ];

    super(providers, {
      failureThreshold: 3,
      resetTimeout: 60000,
      errorThresholdPercentage: 30,
    });
  }
}

/**
 * LLM Provider Failover
 */
export class LLMFailover extends FailoverManager {
  constructor() {
    const providers: Provider[] = [
      {
        name: 'openai-gpt4',
        priority: 1,
        execute: async (_prompt: string, _messages: any[]) => {
          throw new Error('LLM provider not wired at shared layer. Implement in service.');
        },
      },
    ];

    super(providers, {
      failureThreshold: 2,
      resetTimeout: 30000,
      timeout: 30000,
    });
  }
}

/**
 * TTS Provider Failover
 */
export class TTSFailover extends FailoverManager {
  constructor() {
    const providers: Provider[] = [
      {
        name: 'deepgram',
        priority: 1,
        execute: async (_text: string) => {
          throw new Error('TTS provider not wired at shared layer. Implement in service.');
        },
      },
    ];

    super(providers, {
      failureThreshold: 3,
      resetTimeout: 60000,
    });
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries || 3;
  const initialDelay = options.initialDelay || 1000;
  const maxDelay = options.maxDelay || 30000;
  const factor = options.factor || 2;

  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.min(initialDelay * Math.pow(factor, attempt), maxDelay);
        
        if (options.onRetry) {
          options.onRetry(attempt + 1, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Rate limiter
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];

  constructor(
    private maxTokens: number,
    private refillRate: number, // tokens per second
    private refillInterval: number = 1000 // milliseconds
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    
    // Start refill timer
    setInterval(() => this.refill(), this.refillInterval);
  }

  async acquire(tokens: number = 1): Promise<void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        this.refill();
        
        if (this.tokens >= tokens) {
          this.tokens -= tokens;
          resolve();
        } else {
          this.queue.push(tryAcquire);
        }
      };
      
      tryAcquire();
    });
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = (timePassed / 1000) * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
    
    // Process queued requests
    while (this.queue.length > 0 && this.tokens > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// Provider singletons are application-specific and should be created in the service layer.
// export const asrFailover = new ASRFailover();
// export const llmFailover = new LLMFailover();
// export const ttsFailover = new TTSFailover();