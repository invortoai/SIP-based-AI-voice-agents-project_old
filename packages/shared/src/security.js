import crypto from 'crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import ipRangeCheck from 'ip-range-check';
// AWS Secrets Manager client
const secretsClient = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'ap-south-1',
});
// Cache for secrets to avoid repeated API calls
const secretsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
/**
 * Retrieve secret from AWS Secrets Manager with caching
 */
export async function getSecret(secretName) {
    // Check cache first
    const cached = secretsCache.get(secretName);
    if (cached && cached.expiry > Date.now()) {
        return cached.value;
    }
    try {
        const command = new GetSecretValueCommand({
            SecretId: secretName,
        });
        const response = await secretsClient.send(command);
        const secretValue = response.SecretString || '';
        // Cache the secret
        secretsCache.set(secretName, {
            value: secretValue,
            expiry: Date.now() + CACHE_TTL,
        });
        return secretValue;
    }
    catch (error) {
        console.error(`Failed to retrieve secret ${secretName}:`, error);
        throw new Error(`Failed to retrieve secret: ${secretName}`);
    }
}
/**
 * Get structured secret (JSON) from AWS Secrets Manager
 */
export async function getSecretJson(secretName) {
    const secretString = await getSecret(secretName);
    try {
        return JSON.parse(secretString);
    }
    catch (error) {
        throw new Error(`Failed to parse secret ${secretName} as JSON`);
    }
}
/**
 * IP Allowlist Manager
 */
export class IPAllowlistManager {
    allowedRanges = [];
    allowedIPs = new Set();
    bypassTokens = new Set();
    constructor() {
        this.loadAllowlist();
    }
    async loadAllowlist() {
        // Load from environment or secrets manager
        const allowlistConfig = process.env.IP_ALLOWLIST || '';
        const ranges = allowlistConfig.split(',').filter(Boolean);
        // Try to load from AWS Secrets Manager
        try {
            const secretAllowlist = await getSecretJson('ip-allowlist');
            if (secretAllowlist) {
                this.allowedRanges = secretAllowlist.ranges || [];
                this.allowedIPs = new Set(secretAllowlist.ips || []);
                this.bypassTokens = new Set(secretAllowlist.tokens || []);
            }
        }
        catch {
            // Fall back to environment config
            this.allowedRanges = ranges;
        }
        // Always allow localhost in development
        if (process.env.NODE_ENV === 'development') {
            this.allowedIPs.add('127.0.0.1');
            this.allowedIPs.add('::1');
            this.allowedRanges.push('10.0.0.0/8');
            this.allowedRanges.push('172.16.0.0/12');
            this.allowedRanges.push('192.168.0.0/16');
        }
    }
    isAllowed(ip, bypassToken) {
        // Check bypass token first
        if (bypassToken && this.bypassTokens.has(bypassToken)) {
            return true;
        }
        // Check exact IP match
        if (this.allowedIPs.has(ip)) {
            return true;
        }
        // Check IP ranges
        return ipRangeCheck(ip, this.allowedRanges);
    }
    addIP(ip) {
        this.allowedIPs.add(ip);
    }
    removeIP(ip) {
        this.allowedIPs.delete(ip);
    }
    addRange(range) {
        this.allowedRanges.push(range);
    }
    getClientIP(req) {
        // Check various headers for the real IP
        const forwardedFor = req.headers['x-forwarded-for'];
        if (forwardedFor) {
            const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
            return ips.split(',')[0].trim();
        }
        const realIP = req.headers['x-real-ip'];
        if (realIP) {
            return Array.isArray(realIP) ? realIP[0] : realIP;
        }
        return req.socket.remoteAddress || '';
    }
}
/**
 * PII Redaction utilities
 */
export class PIIRedactor {
    options;
    // Patterns for common PII
    patterns = {
        email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
        phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
        ssn: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g,
        creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
        ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        dateOfBirth: /\b(0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g,
        passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
        driverLicense: /\b[A-Z]{1,2}\d{5,8}\b/g,
        // Indian specific
        aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
        pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    };
    // Custom patterns that can be added
    customPatterns = new Map();
    constructor(options = {}) {
        this.options = options;
        this.options = {
            replaceWith: '[REDACTED]',
            preserveLength: false,
            hashPII: false,
            ...options,
        };
    }
    addCustomPattern(name, pattern) {
        this.customPatterns.set(name, pattern);
    }
    redact(text, piiTypes) {
        let redactedText = text;
        // Determine which patterns to use
        const patternsToUse = piiTypes
            ? Object.entries(this.patterns).filter(([key]) => piiTypes.includes(key))
            : Object.entries(this.patterns);
        // Apply standard patterns
        for (const [type, pattern] of patternsToUse) {
            redactedText = redactedText.replace(pattern, (match) => this.getReplacement(match, type));
        }
        // Apply custom patterns
        if (!piiTypes || piiTypes.includes('custom')) {
            for (const [name, pattern] of this.customPatterns) {
                redactedText = redactedText.replace(pattern, (match) => this.getReplacement(match, name));
            }
        }
        return redactedText;
    }
    getReplacement(original, type) {
        if (this.options.hashPII) {
            // Create a deterministic hash for the PII
            const hash = crypto.createHash('sha256').update(original).digest('hex').substring(0, 8);
            return `[${type.toUpperCase()}-${hash}]`;
        }
        if (this.options.preserveLength) {
            return '*'.repeat(original.length);
        }
        return this.options.replaceWith || '[REDACTED]';
    }
    // Redact PII from objects
    redactObject(obj, piiTypes) {
        if (typeof obj === 'string') {
            return this.redact(obj, piiTypes);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.redactObject(item, piiTypes));
        }
        if (obj && typeof obj === 'object') {
            const redacted = {};
            for (const [key, value] of Object.entries(obj)) {
                // Check if key name suggests PII
                const lowerKey = key.toLowerCase();
                if (this.isPIIField(lowerKey)) {
                    redacted[key] = this.options.replaceWith;
                }
                else {
                    redacted[key] = this.redactObject(value, piiTypes);
                }
            }
            return redacted;
        }
        return obj;
    }
    isPIIField(fieldName) {
        const piiFieldNames = [
            'email', 'phone', 'ssn', 'social_security',
            'credit_card', 'creditcard', 'card_number',
            'date_of_birth', 'dob', 'birthdate',
            'passport', 'driver_license', 'license_number',
            'aadhaar', 'pan', 'tax_id',
            'password', 'secret', 'token', 'api_key',
        ];
        return piiFieldNames.some(pii => fieldName.includes(pii));
    }
}
/**
 * Request Sanitizer - combines IP checking and PII redaction
 */
export class RequestSanitizer {
    ipManager;
    piiRedactor;
    constructor() {
        this.ipManager = new IPAllowlistManager();
        this.piiRedactor = new PIIRedactor({
            replaceWith: '[REDACTED]',
            hashPII: true,
        });
    }
    /**
     * Middleware for Express/Fastify to check IP allowlist
     */
    ipCheckMiddleware() {
        return (req, res, next) => {
            const clientIP = this.ipManager.getClientIP(req);
            const bypassToken = req.headers['x-bypass-token'];
            if (!this.ipManager.isAllowed(clientIP, bypassToken)) {
                return res.status(403).send({
                    error: 'Forbidden',
                    message: 'Your IP address is not allowed',
                });
            }
            next();
        };
    }
    /**
     * Sanitize request body by redacting PII
     */
    sanitizeRequestBody(body) {
        return this.piiRedactor.redactObject(body);
    }
    /**
     * Sanitize response body by redacting PII
     */
    sanitizeResponseBody(body) {
        // Be more selective about response redaction
        return this.piiRedactor.redactObject(body, ['email', 'phone', 'ssn', 'creditCard']);
    }
    /**
     * Sanitize logs by redacting PII
     */
    sanitizeLogData(data) {
        return this.piiRedactor.redactObject(data);
    }
}
/**
 * Encryption utilities for sensitive data
 */
export class DataEncryption {
    masterKey;
    algorithm = 'aes-256-gcm';
    keyLength = 32;
    ivLength = 16;
    tagLength = 16;
    saltLength = 64;
    iterations = 100000;
    constructor(masterKey) {
        this.masterKey = masterKey;
        if (!masterKey) {
            this.masterKey = process.env.ENCRYPTION_KEY || '';
        }
        if (!this.masterKey) {
            throw new Error('Encryption key not provided');
        }
    }
    /**
     * Encrypt sensitive data
     */
    encrypt(text) {
        const salt = crypto.randomBytes(this.saltLength);
        const key = crypto.pbkdf2Sync(this.masterKey, salt, this.iterations, this.keyLength, 'sha256');
        const iv = crypto.randomBytes(this.ivLength);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(text, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
    }
    /**
     * Decrypt sensitive data
     */
    decrypt(encryptedData) {
        const buffer = Buffer.from(encryptedData, 'base64');
        const salt = buffer.slice(0, this.saltLength);
        const iv = buffer.slice(this.saltLength, this.saltLength + this.ivLength);
        const tag = buffer.slice(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.tagLength);
        const encrypted = buffer.slice(this.saltLength + this.ivLength + this.tagLength);
        const key = crypto.pbkdf2Sync(this.masterKey, salt, this.iterations, this.keyLength, 'sha256');
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(encrypted) + decipher.final('utf8');
    }
    /**
     * Hash sensitive data (one-way)
     */
    hash(text) {
        return crypto.createHash('sha256').update(text).digest('hex');
    }
}
/**
 * API Key Manager using AWS Secrets Manager
 */
export class APIKeyManager {
    apiKeys = new Map();
    async loadAPIKeys() {
        try {
            const keys = await getSecretJson('api-keys');
            this.apiKeys = new Map(Object.entries(keys));
        }
        catch (error) {
            console.error('Failed to load API keys:', error);
        }
    }
    validateAPIKey(key) {
        const keyData = this.apiKeys.get(key);
        if (!keyData) {
            return { valid: false };
        }
        return {
            valid: true,
            tenantId: keyData.tenantId,
            permissions: keyData.permissions,
        };
    }
    hasPermission(key, permission) {
        const keyData = this.apiKeys.get(key);
        return keyData ? keyData.permissions.includes(permission) : false;
    }
}
// Export singleton instances
export const requestSanitizer = new RequestSanitizer();
export const apiKeyManager = new APIKeyManager();
// Initialize API keys on module load
apiKeyManager.loadAPIKeys().catch(console.error);
//# sourceMappingURL=security.js.map