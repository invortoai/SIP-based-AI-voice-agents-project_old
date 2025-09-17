/**
 * Feature Flags System
 * 
 * Provides a simple feature flag implementation for enabling/disabling features
 * in the application. Supports both simple boolean flags and more complex
 * percentage-based rollouts.
 */

export interface FeatureFlagConfig {
  enabled: boolean;
  percentage?: number; // 0-100 for percentage rollouts
  tenantWhitelist?: string[]; // Specific tenants for which feature is enabled
  environmentWhitelist?: string[]; // Environments where feature is enabled
}

export class FeatureFlags {
  private flags: Map<string, FeatureFlagConfig>;
  private tenantId?: string;
  private environment: string;

  constructor(tenantId?: string, environment: string = (((globalThis as any)?.process?.env?.NODE_ENV) ?? 'development')) {
    this.flags = new Map();
    this.tenantId = tenantId;
    this.environment = environment;
  }

  /**
   * Set a feature flag configuration
   */
  setFlag(name: string, config: FeatureFlagConfig): void {
    this.flags.set(name, config);
  }

  /**
   * Check if a feature flag is enabled
   */
  isEnabled(name: string): boolean {
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
  loadFlags(flags: Record<string, FeatureFlagConfig>): void {
    for (const [name, config] of Object.entries(flags)) {
      this.setFlag(name, config);
    }
  }

  /**
   * Get all feature flags and their status
   */
  getAllFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const name of this.flags.keys()) {
      result[name] = this.isEnabled(name);
    }
    return result;
  }

  /**
   * Simple hash function for consistent percentage rollouts
   */
  private simpleHash(str: string): number {
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