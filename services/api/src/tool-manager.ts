// Dynamic Tool Management System
import { FastifyInstance } from 'fastify';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: any) => Promise<any>;
}

export interface ToolConfig {
  name: string;
  type: 'document' | 'calendar' | 'custom';
  provider?: string;
  description: string;
  parameters: Record<string, any>;
  endpoint?: string;
}

export class ToolManager {
  private tools = new Map<string, ToolDefinition>();

  // Register any tool dynamically
  async registerTool(config: ToolConfig): Promise<ToolDefinition> {
    const toolDef: ToolDefinition = {
      name: config.name,
      description: config.description,
      parameters: config.parameters,
      handler: this.createHandler(config)
    };

    // Store tool configuration
    this.tools.set(config.name, toolDef);

    return toolDef;
  }

  private createHandler(config: ToolConfig) {
    return async (args: any) => {
      switch (config.type) {
        case 'document':
          return this.handleDocumentQuery(args, config);
        case 'calendar':
          return this.handleCalendarAction(args, config);
        case 'custom':
          return this.handleCustomTool(args, config);
      }
    };
  }

  private async handleDocumentQuery(args: any, config: ToolConfig) {
    // Generic document querying logic
    const response = await fetch(`${process.env.API_BASE_URL}/tools/query-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-call-id': args.callId || 'unknown'
      },
      body: JSON.stringify({
        query: args.query,
        documentType: config.provider // e.g., 'pdf', 'txt', etc.
      })
    });

    if (!response.ok) {
      throw new Error(`Document query failed: ${response.statusText}`);
    }

    return response.json();
  }

  private async handleCalendarAction(args: any, config: ToolConfig) {
    // Generic calendar action logic
    const endpoint = args.action === 'check' ? 'check-calendar' : 'book-appointment';
    const response = await fetch(`${process.env.API_BASE_URL}/tools/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-call-id': args.callId || 'unknown'
      },
      body: JSON.stringify({
        ...args,
        provider: config.provider // e.g., 'google', 'outlook', 'custom'
      })
    });

    if (!response.ok) {
      throw new Error(`Calendar action failed: ${response.statusText}`);
    }

    return response.json();
  }

  private async handleCustomTool(args: any, config: ToolConfig) {
    // Call custom endpoint
    if (!config.endpoint) {
      throw new Error('Custom tool requires endpoint configuration');
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-call-id': args.callId || 'unknown'
      },
      body: JSON.stringify(args)
    });

    if (!response.ok) {
      throw new Error(`Custom tool failed: ${response.statusText}`);
    }

    return response.json();
  }

  // Get tool definition
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  // List all registered tools
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  // Remove tool
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  // Execute tool directly
  async executeTool(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    return tool.handler(args);
  }
}

// API endpoints for tool management
export function setupToolManager(app: FastifyInstance) {
  const toolManager = new ToolManager();

  // Register a new tool
  app.post('/tools/register', async (req, reply) => {
    const config = req.body as ToolConfig;

    try {
      const toolDef = await toolManager.registerTool(config);
      return {
        success: true,
        tool: {
          name: toolDef.name,
          description: toolDef.description,
          parameters: toolDef.parameters
        }
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed'
      });
    }
  });

  // Execute tool
  app.post('/tools/:name', async (req, reply) => {
    const { name } = req.params as any;
    const args = req.body;

    try {
      const result = await toolManager.executeTool(name, args);
      return result;
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed'
      });
    }
  });

  // List registered tools
  app.get('/tools', async (req, reply) => {
    const tools = toolManager.listTools();
    return {
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    };
  });

  // Remove tool
  app.delete('/tools/:name', async (req, reply) => {
    const { name } = req.params as any;
    const removed = toolManager.removeTool(name);

    return {
      success: removed,
      message: removed ? `Tool '${name}' removed` : `Tool '${name}' not found`
    };
  });

  return toolManager;
}