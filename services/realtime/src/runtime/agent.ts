import { EventEmitter } from 'events';
import { DeepgramWsAsr } from '../adapters/asr/deepgram_ws';
import { OpenAiClient } from '../adapters/llm/openai';
import { DeepgramTtsClient } from '../adapters/tts/deepgram';
import { TimelinePublisher } from '../timeline/redis';
import { JitterBuffer } from './jitterBuffer';
import { EnergyMeter } from './energyMeter';
import { AudioAnalyzer } from './audioAnalyzer';
import { AdvancedEndpointing, EndpointingConfig } from './endpointing';
import { ToolRegistry } from '../tools/registry';
import { WsOutbound } from '@invorto/shared';

export enum ConversationState {
  IDLE = 'idle',
  LISTENING = 'listening',
  PROCESSING = 'processing',
  SPEAKING = 'speaking',
  ENDING = 'ending'
}

interface Turn {
  id: string;
  startTime: number;
  endTime?: number;
  userTranscript?: string;
  agentResponse?: string;
  metadata?: Record<string, any>;
}

interface QueuedMessage {
  type: 'audio' | 'text' | 'control' | 'tool_result';
  data: any;
  timestamp: number;
  priority: number;
}

export interface AgentConfig {
  asrApiKey: string;
  openaiApiKey: string;
  ttsApiKey: string;
  agentId?: string;
  prompt?: string;
  voice?: string;
  locale?: string;
  temperature?: number;
  maxTokens?: number;
  endpointing?: {
    provider: 'invorto' | 'livekit' | 'off';
    silenceMs?: number;
    minWords?: number;
    confidenceThreshold?: number;
    waitFunction?: string;
  };
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }>;
}

export class AgentRuntime extends EventEmitter {
  private state: ConversationState = ConversationState.IDLE;
  private config: AgentConfig;
  private callId: string;
  private timeline: TimelinePublisher;
  private sendMessage: (msg: WsOutbound) => void;

  private asrAdapter: DeepgramWsAsr | null = null;
  private llmAdapter: OpenAiClient | null = null;
  private ttsAdapter: DeepgramTtsClient | null = null;

  private jitterBuffer: JitterBuffer;
  private energyMeter: EnergyMeter;
  private audioAnalyzer: AudioAnalyzer;
  private endpointing: AdvancedEndpointing;

  private toolRegistry: ToolRegistry | null = null;

  private conversationHistory: Turn[] = [];
  private currentTurn: Turn | null = null;
  private messageQueue: QueuedMessage[] = [];
  private processingQueue = false;

  private context: Map<string, any> = new Map();
  private maxContextSize = 10;

  private isSpeaking = false;

  private usage = {
    asrSeconds: 0,
    llmTokensIn: 0,
    llmTokensOut: 0,
    ttsCharacters: 0,
    toolCalls: 0
  };

  constructor(
    config: AgentConfig,
    sendMessage: (msg: WsOutbound) => void,
    callId: string,
    timeline: TimelinePublisher
  ) {
    super();
    this.config = config;
    this.sendMessage = sendMessage;
    this.callId = callId;
    this.timeline = timeline;

    this.jitterBuffer = new JitterBuffer({
      targetMs: 40,
      sampleRate: 16000,
      channels: 1,
      frameMs: 20
    });

    this.energyMeter = new EnergyMeter({
      sampleRate: 16000,
      intervalMs: 250,
      speakingThresholdDb: -50,
      minHoldWindows: 2
    });

    this.audioAnalyzer = new AudioAnalyzer({
      sampleRate: 16000,
      silenceThreshold: -50,
      speechThreshold: -40,
      windowSize: 1024
    });

    this.endpointing = new AdvancedEndpointing({
      provider: this.config.endpointing?.provider || 'invorto',
      silenceMs: this.config.endpointing?.silenceMs,
      minWords: this.config.endpointing?.minWords,
      confidenceThreshold: this.config.endpointing?.confidenceThreshold,
      waitFunction: this.config.endpointing?.waitFunction
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Forward energy windows to client for simple emotion graph
    // and apply a simple barge-in heuristic while the agent is speaking.
    let bargeCount = 0;
    const bargeThreshold = 2; // consecutive speaking windows

    this.energyMeter.onWindow((window) => {
      this.sendMessage({
        t: 'emotion.window',
        energy_db: window.energyDb,
        speaking: window.speaking
      } as any);

      if (this.state === ConversationState.SPEAKING) {
        if (window.speaking) {
          bargeCount += 1;
          if (bargeCount >= bargeThreshold) {
            this.handleBargeIn();
            bargeCount = 0;
          }
        } else {
          bargeCount = 0;
        }
      } else {
        bargeCount = 0;
      }
    });
    
    // Forward audio analyzer windows/states if used by UI
    this.audioAnalyzer.on('emotion.window', (w: any) => {
      this.sendMessage({ t: 'emotion.window', ...w } as any);
    });
    this.audioAnalyzer.on('emotion.state', (s: any) => {
      this.sendMessage({ t: 'emotion.state', ...s } as any);
    });
  }

  async start(): Promise<void> {
    try {
      // ASR (Deepgram WS)
      this.asrAdapter = new DeepgramWsAsr({
        apiKey: this.config.asrApiKey,
        language: this.config.locale || 'en-US',
        sampleRate: 16000,
        model: 'nova-2',
        smart_format: true,
        interim_results: true,
        endpointing: this.config.endpointing?.provider !== 'off' ? 300 : 0
      });

      // LLM (OpenAI)
      this.llmAdapter = new OpenAiClient({
        apiKey: this.config.openaiApiKey,
        model: 'gpt-4o-mini',
        temperature: this.config.temperature ?? 0.7,
        maxTokens: this.config.maxTokens ?? 1000,
        systemPrompt: this.config.prompt || 'You are a helpful AI assistant.',
        tools: undefined // tools can be injected later if desired
      });

      // Register LLM streaming callbacks
      this.llmAdapter.onDelta((text: string) => {
        this.sendMessage({ t: 'llm.delta', text } as any);
      });
      this.llmAdapter.onToolCall((name: string, args: Record<string, unknown>, id: string) => {
        // Forward tool call event then handle
        this.sendMessage({ t: 'tool.call', id, name, args } as any);
        this.handleToolCall(name, args, id).catch(() => {});
      });

      // Make sure to seed system prompt
      await this.llmAdapter.start(this.config.prompt);

      // TTS (Deepgram Aura streaming)
      this.ttsAdapter = new DeepgramTtsClient({
        apiKey: this.config.ttsApiKey,
        voiceId: this.config.voice || 'aura-asteria-en',
        sampleRate: 16000,
        encoding: 'linear16'
      });

      // Tool registry (optional)
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.toolRegistry = new ToolRegistry({
        redisUrl,
        enableDynamicLoading: true,
        securityValidation: true
      });

      // Load tool definitions
      await this.toolRegistry.loadToolDefinitions();

      // ASR callbacks
      this.asrAdapter.onPartial((text, confidence) => {
        this.sendMessage({ t: 'stt.partial', text, confidence, ts: Date.now() } as any);

        // Update endpointing with partial transcription
        if (this.state === ConversationState.LISTENING) {
          const endpointingResult = this.endpointing.processAudioChunk(new Float32Array(0), text);
          if (endpointingResult.shouldEnd) {
            console.log(`Endpointing triggered by transcription: ${endpointingResult.reason}`);
            this.handleEndOfUtterance();
          }
        }
      });
      this.asrAdapter.onFinal((text, confidence, duration) => {
        this.sendMessage({ t: 'stt.final', text, confidence, duration, ts: Date.now() } as any);

        // Final transcription - always process
        this.handleUserTranscript(text).then(() => {
          // Use advanced endpointing to decide if we should end the utterance
          const endpointingResult = this.endpointing.processAudioChunk(new Float32Array(0), text);
          if (endpointingResult.shouldEnd || this.config.endpointing?.provider === 'off') {
            this.handleEndOfUtterance();
          }
        });
      });

      // Also rely on Deepgram utterance end event when available
      this.asrAdapter.on('utteranceEnd', () => {
        if (this.state === ConversationState.LISTENING) {
          this.handleEndOfUtterance();
        }
      });
 
      await this.asrAdapter.start();
      this.energyMeter.start();

      this.setState(ConversationState.LISTENING);

      await this.timeline.publish(this.callId, 'agent.started', {
        agentId: this.config.agentId,
        config: this.config
      });
    } catch (error) {
      console.error('Failed to start agent runtime:', error);
      this.sendMessage({
        t: 'error',
        message: 'Failed to initialize agent',
        error: error instanceof Error ? error.message : String(error)
      } as any);
      throw error;
    }
  }

  async pushAudio(audioChunk: Uint8Array, sequenceNumber?: number, timestamp?: number): Promise<void> {
    if (!this.asrAdapter) return;

    // Use RTP packet structure if sequence number and timestamp provided
    if (sequenceNumber !== undefined && timestamp !== undefined) {
      this.jitterBuffer.push(sequenceNumber, timestamp, audioChunk);
    } else {
      // Fallback for legacy interface - generate sequence number and timestamp
      const seqNum = Math.floor(Date.now() / 20) % 65536; // 16-bit sequence number
      const ts = Date.now();
      this.jitterBuffer.push(seqNum, ts, audioChunk);
    }

    // Try to get buffered audio for processing
    const buffered = this.jitterBuffer.pop();
    if (!buffered) return;

    // Analyze and meter audio
    this.energyMeter.pushPcm16(buffered);
    this.audioAnalyzer.analyzeChunk(buffered);

    if (this.state === ConversationState.LISTENING || this.state === ConversationState.SPEAKING) {
      await this.asrAdapter.pushPcm16(buffered);
      this.usage.asrSeconds += 0.02; // ~20ms

      // Convert to Float32Array for endpointing analysis
      const floatAudio = new Float32Array(buffered.length);
      for (let i = 0; i < buffered.length; i++) {
        floatAudio[i] = buffered[i] / 32768; // Convert from PCM16 to float
      }

      // Check endpointing
      const endpointingResult = this.endpointing.processAudioChunk(floatAudio);

      if (endpointingResult.shouldEnd && this.state === ConversationState.LISTENING) {
        console.log(`Endpointing triggered: ${endpointingResult.reason} (confidence: ${endpointingResult.confidence})`);
        await this.handleEndOfUtterance();
      }
    }
  }

  private async handleUserTranscript(text: string): Promise<void> {
    if (!text || !text.trim()) return;

    if (!this.currentTurn) {
      this.currentTurn = {
        id: `turn_${Date.now()}`,
        startTime: Date.now(),
        userTranscript: text
      };
    } else {
      this.currentTurn.userTranscript = `${this.currentTurn.userTranscript || ''} ${text}`.trim();
    }

    this.queueMessage({
      type: 'text',
      data: text,
      timestamp: Date.now(),
      priority: 1
    });

    await this.processMessageQueue();
  }

  private async handleEndOfUtterance(): Promise<void> {
    if (this.state !== ConversationState.LISTENING) return;

    this.setState(ConversationState.PROCESSING);

    if (this.currentTurn?.userTranscript) {
      await this.generateResponse(this.currentTurn.userTranscript);
    }
  }

  private async handleBargeIn(): Promise<void> {
    if (!this.isSpeaking) return;

    if (this.ttsAdapter) {
      this.ttsAdapter.interrupt();
    }

    this.messageQueue = this.messageQueue.filter((m) => m.type !== 'audio');

    this.setState(ConversationState.LISTENING);
    this.isSpeaking = false;

    this.sendMessage({ t: 'control.bargein', action: 'stop-tts' } as any);

    await this.timeline.publish(this.callId, 'bargein.detected', { timestamp: Date.now() });
  }

  private async generateResponse(userInput: string): Promise<void> {
    if (!this.llmAdapter) return;

    try {
      if (this.currentTurn) {
        this.currentTurn.userTranscript = userInput;
      }

      // Push user text into LLM; streaming deltas handled via onDelta
      await this.llmAdapter.provideUserText(userInput);
      // Completion event is emitted by adapter; once completed, we speak accumulated text
      const full = this.llmAdapter.getAccumulatedText();
      if (this.currentTurn) this.currentTurn.agentResponse = full;

      await this.generateAndSpeak(full || ""); // speak whatever model returned
    } catch (error) {
      console.error('Failed to generate response:', error);
      await this.generateAndSpeak("I'm sorry, I encountered an error. Please try again.");
    }
  }

  private async generateAndSpeak(text: string): Promise<void> {
    if (!this.ttsAdapter || !text) {
      this.setState(ConversationState.LISTENING);
      return;
    }

    this.setState(ConversationState.SPEAKING);
    this.isSpeaking = true;

    try {
      this.usage.ttsCharacters += text.length;

      // Wire TTS streaming callbacks for this utterance
      this.ttsAdapter.onChunk((chunk: Uint8Array) => {
        this.sendMessage({
          t: 'tts.chunk',
          audio: Buffer.from(chunk).toString('base64'),
          seq: Date.now()
        } as any);
      });

      this.ttsAdapter.onComplete(() => {
        if (this.currentTurn) {
          this.currentTurn.endTime = Date.now();
          this.conversationHistory.push(this.currentTurn);
          this.currentTurn = null;
        }
        this.setState(ConversationState.LISTENING);
        this.isSpeaking = false;
      });

      await this.ttsAdapter.synthesize(text);
    } catch (error) {
      console.error('Failed to generate speech:', error);
      this.setState(ConversationState.LISTENING);
      this.isSpeaking = false;
    }
  }

  private async handleToolCall(name: string, args: Record<string, unknown>, id: string): Promise<void> {
    try {
      this.usage.toolCalls++;

      // Check if tool registry is available
      if (!this.toolRegistry) {
        await this.llmAdapter?.provideToolResult(id, { ok: false, error: 'not_configured' });
        await this.timeline.publish(this.callId, 'tool.executed', {
          name,
          arguments: args,
          result: { ok: false, error: 'not_configured' }
        });
        return;
      }

      // Get tool definition from registry
      const toolDefinition = this.toolRegistry.getToolDefinition(name);
      if (!toolDefinition) {
        await this.llmAdapter?.provideToolResult(id, { ok: false, error: 'no_tool_definition' });
        await this.timeline.publish(this.callId, 'tool.executed', {
          name,
          arguments: args,
          result: { ok: false, error: 'no_tool_definition' }
        });
        return;
      }

      // Execute the tool using registry
      const result = await this.toolRegistry.executeTool(name, args);
      
      // Send result back to LLM
      await this.llmAdapter?.provideToolResult(id, result);
      
      // Publish to timeline
      await this.timeline.publish(this.callId, 'tool.executed', {
        name,
        arguments: args,
        result
      });
    } catch (error) {
      console.error('Tool execution failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'tool_failed';
      await this.llmAdapter?.provideToolResult(id, {
        ok: false,
        error: errorMessage
      });
      await this.timeline.publish(this.callId, 'tool.executed', {
        name,
        arguments: args,
        result: { ok: false, error: errorMessage }
      });
    }
  }

  private setState(newState: ConversationState): void {
    const oldState = this.state;
    this.state = newState;

    this.emit('stateChange', { oldState, newState });

    this.timeline
      .publish(this.callId, 'state.changed', {
        from: oldState,
        to: newState,
        timestamp: Date.now()
      })
      .catch(() => {});
  }

  private queueMessage(message: QueuedMessage): void {
    this.messageQueue.push(message);
    this.messageQueue.sort((a, b) => a.priority - b.priority);
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (!message) continue;

      try {
        switch (message.type) {
          case 'text':
            // already handled
            break;
          case 'audio':
            // handled in pushAudio
            break;
          case 'control':
            await this.handleControlMessage(message.data);
            break;
          case 'tool_result':
            await this.llmAdapter?.provideToolResult(message.data.id, message.data.result);
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    }

    this.processingQueue = false;
  }

  private async handleControlMessage(data: any): Promise<void> {
    switch (data.action) {
      case 'pause':
        this.setState(ConversationState.IDLE);
        break;
      case 'resume':
        this.setState(ConversationState.LISTENING);
        break;
      case 'end':
        await this.end();
        break;
    }
  }

  async updateConfig(updates: Partial<AgentConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };

    await this.timeline.publish(this.callId, 'config.updated', {
      updates,
      timestamp: Date.now()
    });
  }

  async endTurn(): Promise<void> {
    if (this.currentTurn) {
      this.currentTurn.endTime = Date.now();
      this.conversationHistory.push(this.currentTurn);
      this.currentTurn = null;
    }
  }

  async end(): Promise<void> {
    this.setState(ConversationState.ENDING);

    try {
      await this.asrAdapter?.end();
    } catch {}
    try {
      this.ttsAdapter?.interrupt();
    } catch {}

    this.energyMeter.stop();

    if (this.currentTurn) {
      this.currentTurn.endTime = Date.now();
      this.conversationHistory.push(this.currentTurn);
      this.currentTurn = null;
    }

    await this.timeline.publish(this.callId, 'agent.ended', {
      usage: this.usage,
      turns: this.conversationHistory.length,
      duration:
        this.conversationHistory.length > 0
          ? Date.now() - this.conversationHistory[0].startTime
          : 0
    });

    this.setState(ConversationState.IDLE);
  }

  getUsage(): typeof this.usage {
    return { ...this.usage };
  }

  getConversationHistory(): Turn[] {
    return [...this.conversationHistory];
  }

  isActive(): boolean {
    return this.state !== ConversationState.IDLE && this.state !== ConversationState.ENDING;
  }

  /**
   * Get jitter buffer statistics for monitoring
   */
  getJitterBufferStats(): any {
    return this.jitterBuffer.getStats();
  }

  /**
   * Configure jitter buffer settings
   */
  configureJitterBuffer(options: {
    adaptiveMode?: boolean;
    plcEnabled?: boolean;
  }): void {
    if (options.adaptiveMode !== undefined) {
      this.jitterBuffer.setAdaptiveMode(options.adaptiveMode);
    }
    if (options.plcEnabled !== undefined) {
      this.jitterBuffer.setPlcEnabled(options.plcEnabled);
    }
  }
}
