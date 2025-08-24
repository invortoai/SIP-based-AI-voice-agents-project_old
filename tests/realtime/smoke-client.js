// Simple WS smoke test: connects to realtime, streams a 1kHz tone for 2s, logs emotion/window
const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:8081/v1/realtime/smoke-1';
const API_KEY = process.env.REALTIME_API_KEY || '';

function generateToneFrame(sampleRate = 16000, freq = 1000, durationMs = 20, amplitude = 0.25) {
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const s = Math.sin(2 * Math.PI * freq * t) * amplitude;
    const val = Math.max(-1, Math.min(1, s));
    buf.writeInt16LE(Math.floor(val * 32767), i * 2);
  }
  return buf;
}

async function main() {
  const headers = {};
  if (API_KEY) headers['Sec-WebSocket-Protocol'] = API_KEY;
  const ws = new WebSocket(WS_URL, API_KEY ? [API_KEY] : undefined);

  let windows = 0;
  ws.on('open', () => {
    console.log('WS connected');
    ws.send(JSON.stringify({ t: 'start', agentId: 'smoke-agent' }));
    // stream 2s of 1kHz tone
    const frame = generateToneFrame();
    let sent = 0;
    const it = setInterval(() => {
      ws.send(frame);
      sent += 20;
      if (sent >= 2000) {
        clearInterval(it);
        setTimeout(() => ws.close(), 500);
      }
    }, 20);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'emotion.window') {
        windows++;
        console.log('emotion.window', msg.energy_db, msg.speaking);
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log('WS closed. emotion.window count =', windows);
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error('WS error', err.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


