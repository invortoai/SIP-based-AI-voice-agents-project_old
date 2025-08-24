import { EventEmitter } from 'events';
/**
 * Jambonz SIP/RTP to WebSocket Bridge
 * Handles bidirectional audio streaming between SIP calls and WebSocket connections
 */
export interface JambonzConfig {
    wsUrl: string;
    apiKey: string;
    rtpPort?: number;
    codecType?: 'PCMU' | 'PCMA' | 'G722' | 'opus';
    sampleRate?: number;
    channels?: number;
}
export interface SipCallInfo {
    callId: string;
    from: string;
    to: string;
    direction: 'inbound' | 'outbound';
    sipHeaders?: Record<string, string>;
}
export declare class JambonzBridge extends EventEmitter {
    private ws;
    private rtpSocket;
    private config;
    private isConnected;
    private sequenceNumber;
    private timestamp;
    private ssrc;
    private audioBuffer;
    private reconnectAttempts;
    private maxReconnectAttempts;
    constructor(config: JambonzConfig);
    /**
     * Connect to Jambonz WebSocket and setup RTP socket
     */
    connect(callInfo: SipCallInfo): Promise<void>;
    /**
     * Setup RTP socket for receiving/sending audio from/to SIP
     */
    private setupRtpSocket;
    /**
     * Connect to Jambonz WebSocket
     */
    private connectWebSocket;
    /**
     * Handle control messages from Jambonz
     */
    private handleControlMessage;
    /**
     * Send audio to SIP via RTP
     */
    private sendAudioToSip;
    /**
     * Create RTP packet with header
     */
    private createRtpPacket;
    /**
     * Parse RTP header from packet
     */
    private parseRtpHeader;
    /**
     * Convert audio from codec to PCM16
     */
    private convertToPcm16;
    /**
     * Convert PCM16 to codec format
     */
    private convertFromPcm16;
    /**
     * μ-law to PCM16 conversion
     */
    private ulawToPcm16;
    /**
     * PCM16 to μ-law conversion
     */
    private pcm16ToUlaw;
    /**
     * A-law to PCM16 conversion
     */
    private alawToPcm16;
    /**
     * PCM16 to A-law conversion
     */
    private pcm16ToAlaw;
    /**
     * μ-law decode table
     */
    private ulawDecode;
    /**
     * μ-law encode
     */
    private ulawEncode;
    /**
     * A-law decode
     */
    private alawDecode;
    /**
     * A-law encode
     */
    private alawEncode;
    /**
     * Reconnect to Jambonz
     */
    private reconnect;
    /**
     * Send audio from application to SIP
     */
    sendAudio(pcm16: Buffer): void;
    /**
     * Send DTMF digit
     */
    sendDtmf(digit: string): void;
    /**
     * Transfer call
     */
    transferCall(destination: string, mode?: 'blind' | 'attended'): void;
    /**
     * Disconnect and cleanup
     */
    disconnect(): void;
    /**
     * Get connection status
     */
    isActive(): boolean;
}
/**
 * Jambonz Application Configuration
 */
export interface JambonzAppConfig {
    name: string;
    accountSid: string;
    applicationSid: string;
    webhookUrl: string;
    webhookMethod: 'GET' | 'POST';
    speechCredentials?: {
        vendor: 'google' | 'aws' | 'microsoft' | 'deepgram';
        credentials: any;
    };
}
/**
 * Create Jambonz application configuration
 */
export declare function createJambonzApp(config: JambonzAppConfig): any;
