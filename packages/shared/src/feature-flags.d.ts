/**
 * Feature Flags System
 *
 * Provides a simple feature flag implementation for enabling/disabling features
 * in the application. Supports both simple boolean flags and more complex
 * percentage-based rollouts.
 */
export interface FeatureFlagConfig {
    enabled: boolean;
    percentage?: number;
    tenantWhitelist?: string[];
    environmentWhitelist?: string[];
}
export declare class FeatureFlags {
    private flags;
    private tenantId?;
    private environment;
    constructor(tenantId?: string, environment?: string);
    /**
     * Set a feature flag configuration
     */
    setFlag(name: string, config: FeatureFlagConfig): void;
    /**
     * Check if a feature flag is enabled
     */
    isEnabled(name: string): boolean;
    /**
     * Load feature flags from a configuration object
     */
    loadFlags(flags: Record<string, FeatureFlagConfig>): void;
    /**
     * Get all feature flags and their status
     */
    getAllFlags(): Record<string, boolean>;
    /**
     * Simple hash function for consistent percentage rollouts
     */
    private simpleHash;
}
export declare const featureFlags: FeatureFlags;
export declare const FEATURE_FLAGS: {
    EMOTION_DETECTION: string;
    PROVIDER_OVERRIDE: string;
    RAG: string;
    SIP_INTEGRATION: string;
    REALTIME_DASHBOARD: string;
    ADVANCED_ANALYTICS: string;
    MULTI_TENANT_BILLING: string;
    COMPLIANCE_MODE: string;
};
