import WebSocket from 'ws';
import { EventEmitter } from 'events';
import dgram from 'dgram';
export class JambonzBridge extends EventEmitter {
    ws = null;
    rtpSocket = null;
    config;
    isConnected = false;
    sequenceNumber = 0;
    timestamp = 0;
    ssrc = Math.floor(Math.random() * 0xffffffff);
    audioBuffer = [];
    reconnectAttempts = 0;
    maxReconnectAttempts = 5;
    constructor(config) {
        super();
        this.config = {
            rtpPort: 10000,
            codecType: 'PCMU',
            sampleRate: 8000,
            channels: 1,
            ...config,
        };
    }
    /**
     * Connect to Jambonz WebSocket and setup RTP socket
     */
    async connect(callInfo) {
        // Setup RTP socket for SIP audio
        this.setupRtpSocket();
        // Connect to Jambonz WebSocket
        await this.connectWebSocket(callInfo);
    }
    /**
     * Setup RTP socket for receiving/sending audio from/to SIP
     */
    setupRtpSocket() {
        this.rtpSocket = dgram.createSocket('udp4');
        this.rtpSocket.on('message', (msg, rinfo) => {
            // Parse RTP header
            const header = this.parseRtpHeader(msg);
            // Extract audio payload (skip RTP header - typically 12 bytes)
            const audioPayload = msg.slice(12);
            // Convert based on codec
            const pcm16 = this.convertToPcm16(audioPayload, this.config.codecType);
            // Send to WebSocket
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(pcm16);
                this.emit('audioFromSip', pcm16);
            }
        });
        this.rtpSocket.on('error', (err) => {
            this.emit('error', new Error(`RTP socket error: ${err.message}`));
        });
        this.rtpSocket.bind(this.config.rtpPort, () => {
            const address = this.rtpSocket.address();
            this.emit('rtpReady', { port: address.port, address: address.address });
        });
    }
    /**
     * Connect to Jambonz WebSocket
     */
    async connectWebSocket(callInfo) {
        return new Promise((resolve, reject) => {
            const wsUrl = `${this.config.wsUrl}?callId=${callInfo.callId}&apiKey=${this.config.apiKey}`;
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'X-Call-Id': callInfo.callId,
                    'X-From': callInfo.from,
                    'X-To': callInfo.to,
                    'X-Direction': callInfo.direction,
                },
            });
            this.ws.on('open', () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.emit('connected', callInfo);
                // Send initial configuration
                this.ws.send(JSON.stringify({
                    type: 'config',
                    codec: this.config.codecType,
                    sampleRate: this.config.sampleRate,
                    channels: this.config.channels,
                }));
                resolve();
            });
            this.ws.on('message', (data) => {
                if (typeof data === 'string') {
                    // Control message
                    const msg = JSON.parse(data);
                    this.handleControlMessage(msg);
                }
                else {
                    // Audio data from WebSocket to send to SIP
                    const audioData = data;
                    this.sendAudioToSip(audioData);
                }
            });
            this.ws.on('error', (err) => {
                this.emit('error', err);
                if (!this.isConnected) {
                    reject(err);
                }
            });
            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                this.emit('disconnected', { code, reason: reason.toString() });
                // Attempt reconnection
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnect(callInfo);
                }
            });
        });
    }
    /**
     * Handle control messages from Jambonz
     */
    handleControlMessage(msg) {
        switch (msg.type) {
            case 'dtmf':
                this.emit('dtmf', msg.digit);
                break;
            case 'call_status':
                this.emit('callStatus', msg.status);
                break;
            case 'error':
                this.emit('error', new Error(msg.message));
                break;
            case 'config_ack':
                this.emit('configAcknowledged');
                break;
            default:
                this.emit('controlMessage', msg);
        }
    }
    /**
     * Send audio to SIP via RTP
     */
    sendAudioToSip(pcm16) {
        if (!this.rtpSocket)
            return;
        // Convert PCM16 to codec format
        const encodedAudio = this.convertFromPcm16(pcm16, this.config.codecType);
        // Create RTP packet
        const rtpPacket = this.createRtpPacket(encodedAudio);
        // Send to SIP endpoint (you need to configure the destination)
        const sipEndpoint = process.env.SIP_RTP_ENDPOINT || 'localhost:5060';
        const [host, port] = sipEndpoint.split(':');
        this.rtpSocket.send(rtpPacket, parseInt(port), host, (err) => {
            if (err) {
                this.emit('error', new Error(`Failed to send RTP: ${err.message}`));
            }
        });
    }
    /**
     * Create RTP packet with header
     */
    createRtpPacket(payload) {
        const header = Buffer.allocUnsafe(12);
        // Version (2), Padding (0), Extension (0), CSRC count (0)
        header[0] = 0x80;
        // Marker (0), Payload type (0 for PCMU, 8 for PCMA)
        const payloadType = this.config.codecType === 'PCMU' ? 0 : 8;
        header[1] = payloadType;
        // Sequence number
        header.writeUInt16BE(this.sequenceNumber++, 2);
        // Timestamp
        header.writeUInt32BE(this.timestamp, 4);
        this.timestamp += 160; // Increment by samples per packet
        // SSRC
        header.writeUInt32BE(this.ssrc, 8);
        return Buffer.concat([header, payload]);
    }
    /**
     * Parse RTP header from packet
     */
    parseRtpHeader(packet) {
        return {
            version: (packet[0] >> 6) & 0x03,
            padding: !!(packet[0] & 0x20),
            extension: !!(packet[0] & 0x10),
            csrcCount: packet[0] & 0x0f,
            marker: !!(packet[1] & 0x80),
            payloadType: packet[1] & 0x7f,
            sequenceNumber: packet.readUInt16BE(2),
            timestamp: packet.readUInt32BE(4),
            ssrc: packet.readUInt32BE(8),
        };
    }
    /**
     * Convert audio from codec to PCM16
     */
    convertToPcm16(data, codec) {
        switch (codec) {
            case 'PCMU':
                return this.ulawToPcm16(data);
            case 'PCMA':
                return this.alawToPcm16(data);
            default:
                return data; // Assume already PCM16
        }
    }
    /**
     * Convert PCM16 to codec format
     */
    convertFromPcm16(data, codec) {
        switch (codec) {
            case 'PCMU':
                return this.pcm16ToUlaw(data);
            case 'PCMA':
                return this.pcm16ToAlaw(data);
            default:
                return data; // Keep as PCM16
        }
    }
    /**
     * μ-law to PCM16 conversion
     */
    ulawToPcm16(ulaw) {
        const pcm16 = Buffer.allocUnsafe(ulaw.length * 2);
        for (let i = 0; i < ulaw.length; i++) {
            const sample = this.ulawDecode(ulaw[i]);
            pcm16.writeInt16LE(sample, i * 2);
        }
        return pcm16;
    }
    /**
     * PCM16 to μ-law conversion
     */
    pcm16ToUlaw(pcm16) {
        const ulaw = Buffer.allocUnsafe(pcm16.length / 2);
        for (let i = 0; i < pcm16.length; i += 2) {
            const sample = pcm16.readInt16LE(i);
            ulaw[i / 2] = this.ulawEncode(sample);
        }
        return ulaw;
    }
    /**
     * A-law to PCM16 conversion
     */
    alawToPcm16(alaw) {
        const pcm16 = Buffer.allocUnsafe(alaw.length * 2);
        for (let i = 0; i < alaw.length; i++) {
            const sample = this.alawDecode(alaw[i]);
            pcm16.writeInt16LE(sample, i * 2);
        }
        return pcm16;
    }
    /**
     * PCM16 to A-law conversion
     */
    pcm16ToAlaw(pcm16) {
        const alaw = Buffer.allocUnsafe(pcm16.length / 2);
        for (let i = 0; i < pcm16.length; i += 2) {
            const sample = pcm16.readInt16LE(i);
            alaw[i / 2] = this.alawEncode(sample);
        }
        return alaw;
    }
    /**
     * μ-law decode table
     */
    ulawDecode(ulawByte) {
        const BIAS = 0x84;
        const CLIP = 32635;
        ulawByte = ~ulawByte;
        const sign = ulawByte & 0x80;
        const exponent = (ulawByte >> 4) & 0x07;
        const mantissa = ulawByte & 0x0f;
        let sample = mantissa << (exponent + 3);
        sample += BIAS << (exponent + 2);
        if (sign === 0)
            sample = -sample;
        return sample > CLIP ? CLIP : sample < -CLIP ? -CLIP : sample;
    }
    /**
     * μ-law encode
     */
    ulawEncode(sample) {
        const BIAS = 0x84;
        const CLIP = 32635;
        const MAX = 0x1fff;
        let sign = 0;
        if (sample < 0) {
            sign = 0x80;
            sample = -sample;
        }
        if (sample > CLIP)
            sample = CLIP;
        sample += BIAS;
        if (sample > MAX)
            sample = MAX;
        const exponent = Math.floor(Math.log2(sample) - 7);
        const mantissa = (sample >> (exponent + 3)) & 0x0f;
        const ulawByte = ~(sign | (exponent << 4) | mantissa);
        return ulawByte & 0xff;
    }
    /**
     * A-law decode
     */
    alawDecode(alawByte) {
        alawByte ^= 0x55;
        const sign = alawByte & 0x80;
        const exponent = (alawByte >> 4) & 0x07;
        const mantissa = alawByte & 0x0f;
        let sample = mantissa << 4;
        sample += 8;
        if (exponent !== 0) {
            sample += 0x100;
            sample <<= exponent - 1;
        }
        return sign ? -sample : sample;
    }
    /**
     * A-law encode
     */
    alawEncode(sample) {
        const ALAW_MAX = 0xfff;
        let sign = 0;
        if (sample < 0) {
            sign = 0x80;
            sample = -sample;
        }
        if (sample > ALAW_MAX)
            sample = ALAW_MAX;
        let exponent = 0;
        let mask = 0x800;
        for (let i = 0; i < 8; i++) {
            if (sample & mask) {
                exponent = 7 - i;
                break;
            }
            mask >>= 1;
        }
        const mantissa = (sample >> ((exponent === 0) ? 4 : (exponent + 3))) & 0x0f;
        const alawByte = sign | (exponent << 4) | mantissa;
        return alawByte ^ 0x55;
    }
    /**
     * Reconnect to Jambonz
     */
    async reconnect(callInfo) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        setTimeout(async () => {
            try {
                await this.connectWebSocket(callInfo);
            }
            catch (err) {
                this.emit('error', new Error(`Reconnection failed: ${err}`));
            }
        }, delay);
    }
    /**
     * Send audio from application to SIP
     */
    sendAudio(pcm16) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(pcm16);
        }
        else {
            // Buffer audio if not connected
            this.audioBuffer.push(pcm16);
            // Limit buffer size
            if (this.audioBuffer.length > 100) {
                this.audioBuffer.shift();
            }
        }
    }
    /**
     * Send DTMF digit
     */
    sendDtmf(digit) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'dtmf',
                digit,
            }));
        }
    }
    /**
     * Transfer call
     */
    transferCall(destination, mode = 'blind') {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'transfer',
                destination,
                mode,
            }));
        }
    }
    /**
     * Disconnect and cleanup
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.rtpSocket) {
            this.rtpSocket.close();
            this.rtpSocket = null;
        }
        this.isConnected = false;
        this.audioBuffer = [];
    }
    /**
     * Get connection status
     */
    isActive() {
        return this.isConnected;
    }
}
/**
 * Create Jambonz application configuration
 */
export function createJambonzApp(config) {
    return {
        application_sid: config.applicationSid,
        name: config.name,
        account_sid: config.accountSid,
        call_hook: {
            url: config.webhookUrl,
            method: config.webhookMethod,
        },
        speech_synthesis_vendor: config.speechCredentials?.vendor || 'google',
        speech_synthesis_voice: 'en-US-Standard-C',
        speech_recognizer_vendor: config.speechCredentials?.vendor || 'google',
        speech_recognizer_language: 'en-US',
    };
}
//# sourceMappingURL=jambonz.js.map