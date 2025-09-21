import { Request } from 'express';
/**
 * Retrieve secret from AWS Secrets Manager with caching
 */
export declare function getSecret(secretName: string): Promise<string>;
/**
 * Get structured secret (JSON) from AWS Secrets Manager
 */
export declare function getSecretJson<T = any>(secretName: string): Promise<T>;
/**
 * IP Allowlist Manager
 */
export declare class IPAllowlistManager {
    private allowedRanges;
    private allowedIPs;
    private bypassTokens;
    constructor();
    private loadAllowlist;
    isAllowed(ip: string, bypassToken?: string): boolean;
    addIP(ip: string): void;
    removeIP(ip: string): void;
    addRange(range: string): void;
    getClientIP(req: Request): string;
}
/**
 * PII Redaction utilities
 */
export declare class PIIRedactor {
    private options;
    private patterns;
    private customPatterns;
    constructor(options?: {
        replaceWith?: string;
        preserveLength?: boolean;
        hashPII?: boolean;
    });
    addCustomPattern(name: string, pattern: RegExp): void;
    redact(text: string, piiTypes?: string[]): string;
    private getReplacement;
    redactObject(obj: any, piiTypes?: string[]): any;
    private isPIIField;
}
/**
 * Request Sanitizer - combines IP checking and PII redaction
 */
export declare class RequestSanitizer {
    private ipManager;
    private piiRedactor;
    constructor();
    /**
     * Middleware for Express/Fastify to check IP allowlist
     */
    ipCheckMiddleware(): (req: any, res: any, next: any) => any;
    /**
     * Sanitize request body by redacting PII
     */
    sanitizeRequestBody(body: any): any;
    /**
     * Sanitize response body by redacting PII
     */
    sanitizeResponseBody(body: any): any;
    /**
     * Sanitize logs by redacting PII
     */
    sanitizeLogData(data: any): any;
}
/**
 * Encryption utilities for sensitive data
 */
export declare class DataEncryption {
    private masterKey?;
    private algorithm;
    private keyLength;
    private ivLength;
    private tagLength;
    private saltLength;
    private iterations;
    constructor(masterKey?: string | undefined);
    /**
     * Encrypt sensitive data
     */
    encrypt(text: string): string;
    /**
     * Decrypt sensitive data
     */
    decrypt(encryptedData: string): string;
    /**
     * Hash sensitive data (one-way)
     */
    hash(text: string): string;
}
/**
 * API Key Manager using AWS Secrets Manager
 */
export declare class APIKeyManager {
    private apiKeys;
    loadAPIKeys(): Promise<void>;
    validateAPIKey(key: string): {
        valid: boolean;
        tenantId?: string;
        permissions?: string[];
    };
    hasPermission(key: string, permission: string): boolean;
}
export declare const requestSanitizer: RequestSanitizer;
export declare const apiKeyManager: APIKeyManager;
