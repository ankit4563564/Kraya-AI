import { fetchWithTimeoutAndRetry } from './http-utils.js';

/**
 * Groq Whisper Large V3 Turbo ASR client for Hinglish voice notes & supplier phone calls.
 * Free Tier: ~2,000 requests/day & ~8 hours of audio/day at ₹0.
 */

export interface TranscriptionResult {
  text: string;
  language: string | null;
  durationSec: number | null;
  model: string;
}

const HINGLISH_PROCUREMENT_PROMPT =
  'Indian SMB procurement call or voice note in English and Hinglish. Common terms: bhav, rate, GST alag se, 5% GST, 18% GST, bhada, transport extra, 30 din udhari, 45 days credit, cash on delivery, FOR godown, ex-factory, corrugated boxes, cartons, bilty, chalan, credit note, AMC, generator spares, quintal, MT, Ramesh, Suresh, Sharma ji.';

export async function transcribeWithGroqWhisper(params: {
  apiKey: string;
  audioBuffer: Uint8Array;
  fileName: string;
  mimeType: string;
  model?: string;
}): Promise<TranscriptionResult> {
  const model = params.model || 'whisper-large-v3-turbo';
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audioBuffer)], {
    type: params.mimeType || 'audio/webm',
  });
  form.append('file', blob, params.fileName || 'voice-note.webm');
  form.append('model', model);
  form.append('prompt', HINGLISH_PROCUREMENT_PROMPT);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  const res = await fetchWithTimeoutAndRetry(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: form,
    },
    { timeoutMs: 30_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
  };

  return {
    text: (data.text ?? '').trim(),
    language: data.language ?? null,
    durationSec: typeof data.duration === 'number' ? data.duration : null,
    model,
  };
}
