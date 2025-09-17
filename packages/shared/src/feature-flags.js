/**
 * Feature Flags System
 *
 * Provides a simple feature flag implementation for enabling/disabling features
 * in the application. Supports both simple boolean flags and more complex
 * percentage-based rollouts.
 */
export class FeatureFlags {
    flags;
    tenantId;
    environment;
    constructor(tenantId, environment = process.env.NODE_ENV || 'development') {
        this.flags = new Map();
        this.tenantId = tenantId;
        this.environment = environment;
    }
    /**
     * Set a feature flag configuration
     */
    setFlag(name, config) {
        this.flags.set(name, config);
    }
    /**
     * Check if a feature flag is enabled
     */
    isEnabled(name) {
        const flag = this.flags.get(name);
        // If flag doesn't exist, default to disabled
        if (!flag) {
            return false;
        }
        // If explicitly disabled, return false
        if (!flag.enabled) {
            return false;
        }
        // Check environment whitelist
        if (flag.environmentWhitelist && !flag.environmentWhitelist.includes(this.environment)) {
            return false;
        }
        // Check tenant whitelist
        if (flag.tenantWhitelist && this.tenantId && !flag.tenantWhitelist.includes(this.tenantId)) {
            return false;
        }
        // If no percentage specified, default to 100%
        const percentage = flag.percentage !== undefined ? flag.percentage : 100;
        // If 100%, always enabled
        if (percentage >= 100) {
            return true;
        }
        // If 0%, always disabled
        if (percentage <= 0) {
            return false;
        }
        // For percentage rollouts, use tenant ID or random number for consistent results
        const seed = this.tenantId || Math.random().toString();
        const hash = this.simpleHash(seed + name);
        const rolloutPercentage = (hash % 100) + 1;
        return rolloutPercentage <= percentage;
    }
    /**
     * Load feature flags from a configuration object
     */
    loadFlags(flags) {
        for (const [name, config] of Object.entries(flags)) {
            this.setFlag(name, config);
        }
    }
    /**
     * Get all feature flags and their status
     */
    getAllFlags() {
        const result = {};
        for (const name of this.flags.keys()) {
            result[name] = this.isEnabled(name);
        }
        return result;
    }
    /**
     * Simple hash function for consistent percentage rollouts
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
}
// Default feature flags instance
export const featureFlags = new FeatureFlags();
// Predefined feature flags for the application
export const FEATURE_FLAGS = {
    EMOTION_DETECTION: 'emotionDetection',
    PROVIDER_OVERRIDE: 'providerOverride',
    RAG: 'rag',
    SIP_INTEGRATION: 'sipIntegration',
    REALTIME_DASHBOARD: 'realtimeDashboard',
    ADVANCED_ANALYTICS: 'advancedAnalytics',
    MULTI_TENANT_BILLING: 'multiTenantBilling',
    COMPLIANCE_MODE: 'complianceMode'
};
//# sourceMappingURL=feature-flags.js.map