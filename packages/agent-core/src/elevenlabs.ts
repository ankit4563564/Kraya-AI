import { fetchWithTimeoutAndRetry } from './http-utils.js';

/**
 * ElevenLabs Speech-to-Text (Scribe v2) + Multilingual Voice Note TTS Integration.
 * Ideal for Kannada, Tamil, Malayalam, Hindi, Hinglish, and Indian English vendor calls & WhatsApp voice notes.
 */

export interface ElevenLabsSttResult {
  text: string;
  languageCode: string | null;
  languageProbability: number | null;
  model: string;
}

export async function transcribeWithElevenLabsScribe(params: {
  apiKey: string;
  audioBuffer: Uint8Array;
  fileName: string;
  mimeType: string;
  modelId?: string;
  languageCode?: string; // optional ISO-639-1/3 e.g. 'tam', 'mal', 'hin', 'eng'; omit for auto-detect
}): Promise<ElevenLabsSttResult> {
  const modelId = params.modelId || 'scribe_v2';
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audioBuffer)], {
    type: params.mimeType || 'audio/webm',
  });
  form.append('file', blob, params.fileName || 'vendor-call.webm');
  form.append('model_id', modelId);
  form.append('diarize', 'true');
  form.append('tag_audio_events', 'false');
  if (params.languageCode) {
    form.append('language_code', params.languageCode);
  }

  const res = await fetchWithTimeoutAndRetry(
    'https://api.elevenlabs.io/v1/speech-to-text',
    {
      method: 'POST',
      headers: {
        'xi-api-key': params.apiKey,
      },
      body: form,
    },
    { timeoutMs: 30_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs Scribe API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    text?: string;
    language_code?: string;
    language_probability?: number;
  };

  return {
    text: (data.text ?? '').trim(),
    languageCode: data.language_code ?? null,
    languageProbability:
      typeof data.language_probability === 'number' ? data.language_probability : null,
    model: modelId,
  };
}

/**
 * Generates an MP3 WhatsApp-ready voice note in English, Hindi, Hinglish, Tamil, or Malayalam
 * using the owner's ElevenLabs subscription.
 */
export async function synthesizeElevenLabsVoiceNote(params: {
  apiKey: string;
  text: string;
  voiceId?: string;
  modelId?: string;
}): Promise<Uint8Array> {
  // Default public multilingual voice ID (Rachel/Aria fallback; override via ELEVENLABS_VOICE_ID with your preferred Indian voice)
  const voiceId = params.voiceId || '21m00Tcm4TlvDq8ikWAM';
  const modelId = params.modelId || 'eleven_multilingual_v2';

  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const res = await fetchWithTimeoutAndRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'xi-api-key': params.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: params.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    },
    { timeoutMs: 25_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs TTS API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}
