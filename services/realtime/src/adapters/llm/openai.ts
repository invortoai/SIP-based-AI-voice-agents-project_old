import OpenAI from "openai";
import { EventEmitter } from "events";

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  systemPrompt?: string;
  tools?: OpenAI.Chat.ChatCompletionTool[];
}

export type LlmDeltaCallback = (text: string) => void;
export type ToolCallCallback = (name: string, args: Record<string, unknown>, id: string) => void;
export type CompletionCallback = (fullText: string, usage?: OpenAI.CompletionUsage) => void;

export class OpenAiClient extends EventEmitter {
  private client: OpenAI;
  private options: OpenAiOptions;
  private onDeltaCb?: LlmDeltaCallback;
  private onToolCallCb?: ToolCallCallback;
  private onCompletionCb?: CompletionCallback;
  private messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  private currentStream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | null = null;
  private abortController: AbortController | null = null;
  private accumulatedText: string = "";
  private toolCallAccumulator: Map<number, {
    id: string;
    name: string;
    arguments: string;
  }> = new Map();

  constructor(options: OpenAiOptions) {
    super();
    this.options = options;
    this.client = new OpenAI({
      apiKey: options.apiKey,
    });
  }

  onDelta(cb: LlmDeltaCallback) {
    this.onDeltaCb = cb;
  }

  onToolCall(cb: ToolCallCallback) {
    this.onToolCallCb = cb;
  }

  onCompletion(cb: CompletionCallback) {
    this.onCompletionCb = cb;
  }

  async start(systemPrompt?: string): Promise<void> {
    const prompt = systemPrompt || this.options.systemPrompt || "You are a helpful AI assistant.";
    this.messages = [
      {
        role: "system",
        content: prompt,
      },
    ];
    this.accumulatedText = "";
    this.toolCallAccumulator.clear();
  }

  async provideUserText(text: string): Promise<void> {
    this.messages.push({
      role: "user",
      content: text,
    });
    
    await this.generateResponse();
  }

  async provideToolResult(toolCallId: string, result: any): Promise<void> {
    this.messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(result),
    });
    
    await this.generateResponse();
  }

  private async generateResponse(): Promise<void> {
    try {
      this.abortController = new AbortController();
      this.accumulatedText = "";
      this.toolCallAccumulator.clear();

      const stream = await this.client.chat.completions.create({
        model: this.options.model || "gpt-4o-mini",
        messages: this.messages,
        temperature: this.options.temperature ?? 0.7,
        max_tokens: this.options.maxTokens ?? 1000,
        top_p: this.options.topP ?? 1,
        frequency_penalty: this.options.frequencyPenalty ?? 0,
        presence_penalty: this.options.presencePenalty ?? 0,
        tools: this.options.tools,
        tool_choice: this.options.tools ? "auto" : undefined,
        stream: true,
      }, {
        signal: this.abortController.signal,
      });

      this.currentStream = stream;
      let fullResponse = "";
      let usage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          fullResponse += delta.content;
          this.accumulatedText += delta.content;
          this.onDeltaCb?.(delta.content);
          this.emit("delta", delta.content);
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            
            if (!this.toolCallAccumulator.has(index)) {
              this.toolCallAccumulator.set(index, {
                id: toolCall.id || "",
                name: toolCall.function?.name || "",
                arguments: "",
              });
            }
            
            const accumulator = this.toolCallAccumulator.get(index)!;
            
            if (toolCall.id) {
              accumulator.id = toolCall.id;
            }
            
            if (toolCall.function?.name) {
              accumulator.name = toolCall.function.name;
            }
            
            if (toolCall.function?.arguments) {
              accumulator.arguments += toolCall.function.arguments;
            }
          }
        }

        if (chunk.usage) {
          usage = chunk.usage;
        }
      }

      // Process accumulated tool calls
      for (const [, toolCall] of this.toolCallAccumulator) {
        if (toolCall.name && toolCall.arguments) {
          try {
            const args = JSON.parse(toolCall.arguments);
            this.onToolCallCb?.(toolCall.name, args, toolCall.id);
            this.emit("toolCall", { name: toolCall.name, args, id: toolCall.id });
            
            // Add assistant message with tool calls to history
            this.messages.push({
              role: "assistant",
              content: null,
              tool_calls: [{
                id: toolCall.id,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              }],
            });
          } catch (error) {
            console.error("Failed to parse tool arguments:", error);
            this.emit("error", error);
          }
        }
      }

      // If there was text content, add it to message history
      if (fullResponse) {
        this.messages.push({
          role: "assistant",
          content: fullResponse,
        });
      }

      this.onCompletionCb?.(fullResponse, usage);
      this.emit("completion", { text: fullResponse, usage });
      
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.emit("aborted");
      } else {
        console.error("OpenAI API error:", error);
        this.emit("error", error);
        throw error;
      }
    } finally {
      this.currentStream = null;
      this.abortController = null;
    }
  }

  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.currentStream = null;
  }

  getMessages(): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
    this.accumulatedText = "";
    this.toolCallAccumulator.clear();
  }

  getAccumulatedText(): string {
    return this.accumulatedText;
  }

  // Helper method to add tools dynamically
  setTools(tools: OpenAI.Chat.ChatCompletionTool[]): void {
    this.options.tools = tools;
  }

  // Helper method to create a tool definition
  static createTool(
    name: string,
    description: string,
    parameters: Record<string, any>,
    required?: string[]
  ): OpenAI.Chat.ChatCompletionTool {
    return {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          properties: parameters,
          required: required || [],
        },
      },
    };
  }
}
