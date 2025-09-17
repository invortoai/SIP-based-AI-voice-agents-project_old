import { ToolExecutor, ToolDefinition } from './executor.js';

export interface ToolRegistryConfig {
  redisUrl: string;
  toolDefinitionsPath?: string;
  enableDynamicLoading?: boolean;
  securityValidation?: boolean;
}

export interface ToolMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: string[];
  lastUpdated: string;
  checksum: string;
}

export class ToolRegistry {
  private executor: ToolExecutor;
  private config: ToolRegistryConfig;
  private toolCache: Map<string, ToolDefinition> = new Map();
  private metadataCache: Map<string, ToolMetadata> = new Map();

  constructor(config: ToolRegistryConfig) {
    this.config = config;
    this.executor = new ToolExecutor(config.redisUrl);
  }

  /**
   * Load tool definitions from secure storage
   */
  async loadToolDefinitions(): Promise<Map<string, ToolDefinition>> {
    if (!this.config.enableDynamicLoading) {
      return this.getDefaultTools();
    }

    try {
      // Load from Redis (secure storage)
      const toolKeys = await this.getToolKeysFromStorage();

      for (const key of toolKeys) {
        const toolDef = await this.loadToolFromStorage(key);
        if (toolDef && this.validateToolDefinition(toolDef)) {
          this.toolCache.set(toolDef.name, toolDef);
        }
      }

      console.log(`Loaded ${this.toolCache.size} tools from secure storage`);
      return this.toolCache;
    } catch (error) {
      console.error('Failed to load tool definitions:', error);
      return this.getDefaultTools();
    }
  }

  /**
   * Register a new tool dynamically
   */
  async registerTool(toolDef: ToolDefinition, metadata: ToolMetadata): Promise<boolean> {
    try {
      // Validate tool definition
      if (!this.validateToolDefinition(toolDef)) {
        throw new Error('Invalid tool definition');
      }

      // Validate metadata
      if (!this.validateToolMetadata(metadata)) {
        throw new Error('Invalid tool metadata');
      }

      // Store in secure storage
      await this.storeToolInStorage(toolDef, metadata);

      // Update cache
      this.toolCache.set(toolDef.name, toolDef);
      this.metadataCache.set(toolDef.name, metadata);

      console.log(`Registered tool: ${toolDef.name} v${metadata.version}`);
      return true;
    } catch (error) {
      console.error(`Failed to register tool ${toolDef.name}:`, error);
      return false;
    }
  }

  /**
   * Unregister a tool
   */
  async unregisterTool(toolName: string): Promise<boolean> {
    try {
      // Remove from storage
      await this.removeToolFromStorage(toolName);

      // Remove from cache
      this.toolCache.delete(toolName);
      this.metadataCache.delete(toolName);

      console.log(`Unregistered tool: ${toolName}`);
      return true;
    } catch (error) {
      console.error(`Failed to unregister tool ${toolName}:`, error);
      return false;
    }
  }

  /**
   * Get tool definition by name
   */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.toolCache.get(name);
  }

  /**
   * Get tool metadata
   */
  getToolMetadata(name: string): ToolMetadata | undefined {
    return this.metadataCache.get(name);
  }

  /**
   * List all available tools
   */
  listTools(): Array<{ definition: ToolDefinition; metadata: ToolMetadata }> {
    const tools = [];
    for (const [name, definition] of this.toolCache.entries()) {
      const metadata = this.metadataCache.get(name);
      if (metadata) {
        tools.push({ definition, metadata });
      }
    }
    return tools;
  }

  /**
   * Execute a tool by name
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<any> {
    const toolDef = this.toolCache.get(name);
    if (!toolDef) {
      throw new Error(`Tool not found: ${name}`);
    }

    return this.executor.execute(toolDef, args);
  }

  /**
   * Validate tool definition
   */
  private validateToolDefinition(toolDef: ToolDefinition): boolean {
    if (!toolDef.name || !toolDef.url || !toolDef.method) {
      return false;
    }

    // Validate URL format
    try {
      new URL(toolDef.url);
    } catch {
      return false;
    }

    // Validate HTTP method
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    if (!validMethods.includes(toolDef.method.toUpperCase())) {
      return false;
    }

    // Validate timeout
    if (toolDef.timeoutMs && (toolDef.timeoutMs < 100 || toolDef.timeoutMs > 30000)) {
      return false;
    }

    return true;
  }

  /**
   * Validate tool metadata
   */
  private validateToolMetadata(metadata: ToolMetadata): boolean {
    if (!metadata.name || !metadata.version || !metadata.author) {
      return false;
    }

    // Validate version format (semver)
    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(metadata.version)) {
      return false;
    }

    // Validate permissions
    if (!Array.isArray(metadata.permissions) || metadata.permissions.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Get default tools (fallback)
   */
  private getDefaultTools(): Map<string, ToolDefinition> {
    const defaultTools = new Map<string, ToolDefinition>();

    // Weather tool
    defaultTools.set('get_weather', {
      name: 'get_weather',
      method: 'GET',
      url: 'https://api.weatherapi.com/v1/current.json',
      headers: {
        'Content-Type': 'application/json'
      },
      inputSchema: {
        location: { type: 'string', required: true },
        apiKey: { type: 'string', required: true }
      },
      timeoutMs: 5000
    });

    // Calculator tool
    defaultTools.set('calculate', {
      name: 'calculate',
      method: 'POST',
      url: 'http://localhost:8080/v1/tools/calculate',
      headers: {
        'Content-Type': 'application/json'
      },
      inputSchema: {
        expression: { type: 'string', required: true }
      },
      timeoutMs: 3000
    });

    return defaultTools;
  }

  /**
   * Storage operations (Redis-based)
   */
  private async getToolKeysFromStorage(): Promise<string[]> {
    // Implementation would query Redis for tool keys
    // For now, return empty array (would be populated from Redis)
    return [];
  }

  private async loadToolFromStorage(key: string): Promise<ToolDefinition | null> {
    // Implementation would load tool definition from Redis
    // For now, return null (would be populated from Redis)
    return null;
  }

  private async storeToolInStorage(toolDef: ToolDefinition, metadata: ToolMetadata): Promise<void> {
    // Implementation would store tool in Redis with metadata
    // This would include security validation and checksum verification
    console.log(`Storing tool ${toolDef.name} in secure storage`);
  }

  private async removeToolFromStorage(toolName: string): Promise<void> {
    // Implementation would remove tool from Redis
    console.log(`Removing tool ${toolName} from secure storage`);
  }

  /**
   * Security validation
   */
  private validateSecurityConstraints(toolDef: ToolDefinition, metadata: ToolMetadata): boolean {
    if (!this.config.securityValidation) {
      return true;
    }

    // Check if tool has required permissions
    const requiredPermissions = ['network_access', 'data_processing'];
    const hasRequiredPermissions = requiredPermissions.every(perm =>
      metadata.permissions.includes(perm)
    );

    if (!hasRequiredPermissions) {
      return false;
    }

    // Validate URL is from allowed domains
    const allowedDomains = ['localhost', 'api.weatherapi.com', 'trusted-domain.com'];
    try {
      const url = new URL(toolDef.url);
      const isAllowedDomain = allowedDomains.some(domain =>
        url.hostname === domain || url.hostname.endsWith('.' + domain)
      );

      if (!isAllowedDomain) {
        return false;
      }
    } catch {
      return false;
    }

    return true;
  }
}