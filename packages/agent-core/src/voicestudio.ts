import { fetchWithTimeoutAndRetry } from './http-utils.js';

/**
 * VoiceStudio (github.com/debpalash/VoiceStudio) — local-first voice cloning provider.
 *
 * VoiceStudio exposes an OpenAI-compatible speech API on its service root
 * (default http://localhost:3900):
 *   POST /v1/audio/speech          — TTS in a cloned voice profile
 *   POST /v1/audio/transcriptions  — STT with the active local recognition engine
 *   GET  /health                   — liveness
 *
 * Loopback callers need no credentials; remote deployments use
 * `Authorization: Bearer <OMNIVOICE_API_KEY>`.
 */

export type VoiceStudioFormat = 'opus' | 'mp3' | 'wav' | 'aac' | 'flac';

export interface VoiceStudioConfig {
  baseUrl: string;
  apiKey?: string;
}

const FORMAT_MIME: Record<VoiceStudioFormat, string> = {
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

/** ISO 639-1 language hints per Kraya outreach language. Hinglish stays on Auto (code-mixed). */
const OUTREACH_LANGUAGE_CODES: Record<string, string | undefined> = {
  english: 'en',
  hindi: 'hi',
  kannada: 'kn',
  tamil: 'ta',
  malayalam: 'ml',
  hinglish: undefined,
};

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function authHeaders(cfg: VoiceStudioConfig): Record<string, string> {
  return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

export function voiceStudioMimeType(format: VoiceStudioFormat): string {
  return FORMAT_MIME[format];
}

export function outreachLanguageToIso(language?: string | null): string | undefined {
  if (!language) return undefined;
  return OUTREACH_LANGUAGE_CODES[language.toLowerCase()];
}

/**
 * Picks the owner's cloned voice profile for a given outreach language.
 *
 * `voiceMapJson` is the VOICESTUDIO_VOICE_MAP env value, e.g.
 *   {"hinglish":"prof_abc","tamil":"prof_def","default":"prof_abc"}
 * Falls back to `default`, then to `fallbackVoiceId` (VOICESTUDIO_VOICE_ID).
 * Returns null when no clone exists — callers must then use a non-cloned voice or text.
 */
export function resolveVoiceStudioVoice(params: {
  language?: string | null;
  voiceMapJson?: string | null;
  fallbackVoiceId?: string | null;
}): { voiceId: string; matchedLanguage: string } | null {
  let map: Record<string, string> = {};
  if (params.voiceMapJson?.trim()) {
    try {
      const parsed = JSON.parse(params.voiceMapJson);
      if (parsed && typeof parsed === 'object') {
        map = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => [k.toLowerCase(), String(v).trim()])
        );
      }
    } catch {
      map = {};
    }
  }
  const lang = (params.language || '').toLowerCase();
  if (lang && map[lang]) return { voiceId: map[lang], matchedLanguage: lang };
  if (map.default) return { voiceId: map.default, matchedLanguage: 'default' };
  if (params.fallbackVoiceId?.trim()) {
    return { voiceId: params.fallbackVoiceId.trim(), matchedLanguage: 'default' };
  }
  return null;
}

/**
 * Synthesizes a voice note in the owner's cloned voice.
 * Default output is Ogg/Opus — WhatsApp's native voice-note format.
 */
export async function synthesizeVoiceStudioVoiceNote(
  params: VoiceStudioConfig & {
    text: string;
    voiceId: string;
    language?: string | null; // Kraya outreach language (english/hinglish/hindi/...)
    model?: string;
    format?: VoiceStudioFormat;
    speed?: number;
    seed?: number;
  }
): Promise<{ audio: Uint8Array; mimeType: string; format: VoiceStudioFormat }> {
  const format = params.format ?? 'opus';
  const body: Record<string, unknown> = {
    model: params.model || 'omnivoice',
    voice: params.voiceId,
    input: params.text,
    response_format: format,
    speed: params.speed ?? 1.0,
  };
  const iso = outreachLanguageToIso(params.language);
  if (iso) body.language = iso;
  // A fixed seed keeps the cloned identity and delivery consistent across voice notes.
  if (typeof params.seed === 'number' && Number.isFinite(params.seed)) body.seed = params.seed;

  const res = await fetchWithTimeoutAndRetry(
    `${trimBase(params.baseUrl)}/v1/audio/speech`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(params) },
      body: JSON.stringify(body),
    },
    // Local CPU synthesis can be slow; a single retry avoids duplicate long renders.
    { timeoutMs: 120_000, maxRetries: 1 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`VoiceStudio TTS error (${res.status}): ${errText.slice(0, 300)}`);
  }

  return {
    audio: new Uint8Array(await res.arrayBuffer()),
    mimeType: FORMAT_MIME[format],
    format,
  };
}

/** Transcribes a vendor voice note / call with VoiceStudio's local STT engine. */
export async function transcribeWithVoiceStudio(
  params: VoiceStudioConfig & {
    audioBuffer: Uint8Array;
    fileName: string;
    mimeType: string;
    language?: string; // optional ISO 639-1
  }
): Promise<{ text: string; languageCode: string | null; model: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audioBuffer)], {
    type: params.mimeType || 'audio/webm',
  });
  form.append('file', blob, params.fileName || 'vendor-voice-note.webm');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  if (params.language) form.append('language', params.language);

  const res = await fetchWithTimeoutAndRetry(
    `${trimBase(params.baseUrl)}/v1/audio/transcriptions`,
    { method: 'POST', headers: authHeaders(params), body: form },
    { timeoutMs: 120_000, maxRetries: 1 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`VoiceStudio STT error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string; language?: string };
  return {
    text: (data.text ?? '').trim(),
    languageCode: data.language ?? null,
    model: 'voicestudio-local-stt',
  };
}

/** Lightweight reachability probe used by /api/health. */
export async function checkVoiceStudioHealth(cfg: VoiceStudioConfig): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`${trimBase(cfg.baseUrl)}/health`, {
      headers: authHeaders(cfg),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export const VOICE_CALIBRATION_SCRIPTS: Record<string, string> = {
  default:
    'Namaste Ramesh ji, humne aapka quotation check kiya. Rate thoda high lag raha hai, agar aap five percent discount aur thirty days credit de sakte hain toh aaj hi purchase order confirm kar denge.',
  hinglish:
    'Namaste Ramesh ji, humne aapka quotation check kiya. Rate thoda high lag raha hai, agar aap five percent discount aur thirty days credit de sakte hain toh aaj hi purchase order confirm kar denge.',
  english:
    'Hello Ramesh, we reviewed your quotation for the raw materials. If you can match our target landed rate and confirm thirty days credit terms, we will issue the formal purchase order today.',
  hindi:
    'नमस्ते रमेश जी, हमने आपका कोटेशन देखा। अगर आप रेट में थोड़ा डिस्काउंट और तीस दिन का क्रेडिट दे दें, तो हम आज ही परचेज ऑर्डर जारी कर देंगे।',
  tamil:
    'வணக்கம் ரமேஷ் சார், உங்கள் கொட்டேஷனை பார்த்தோம். விலையை சற்று குறைத்து முப்பது நாள் கிரெடிட் கொடுத்தால் இன்றே பர்சேஸ் ஆர்டர் அனுப்பி விடுகிறோம்.',
  kannada:
    'ನಮಸ್ಕಾರ ರಮೇಶ್ ಅವರೇ, ನಿಮ್ಮ ಕೊಟೇಶನ್ ಪರಿಶೀಲಿಸಿದ್ದೇವೆ. ದರ ಸ್ವಲ್ಪ ಕಡಿಮೆ ಮಾಡಿ ಮೂವತ್ತು ದಿನ ಕ್ರೆಡಿಟ್ ನೀಡಿದರೆ ಇಂದೇ ಪರ್ಚೇಸ್ ಆರ್ಡರ್ ಕಳುಹಿಸುತ್ತೇವೆ.',
  malayalam:
    'നമസ്കാരം രമേഷ്, നിങ്ങളുടെ ക്വൊട്ടേഷൻ ഞങ്ങൾ പരിശോധിച്ചു. വിലയിൽ ചെറിയൊരു കുറവും മുപ്പത് ദിവസത്തെ ക്രെഡിറ്റും നൽകിയാൽ ഇന്നുതന്നെ പർച്ചേസ് ഓർഡർ നൽകാം.',
};

/**
 * Registers a cloned voice profile (`POST /profiles`) and records own-voice consent
 * (`POST /profiles/{id}/consent`) on a local VoiceStudio instance.
 */
export async function createVoiceStudioCloneProfile(
  params: VoiceStudioConfig & {
    name: string;
    wavBytes: Uint8Array;
    refText: string;
    language?: string;
  }
): Promise<{ profileId: string }> {
  const base = trimBase(params.baseUrl);
  const headers = authHeaders(params);
  const form = new FormData();
  form.append('name', params.name);
  form.append('kind', 'clone');
  form.append('ref_text', params.refText);
  form.append('language', 'Auto');
  form.append(
    'ref_audio',
    new Blob([new Uint8Array(params.wavBytes)], { type: 'audio/wav' }),
    'reference.wav'
  );

  const createRes = await fetchWithTimeoutAndRetry(
    `${base}/profiles`,
    { method: 'POST', headers, body: form },
    { timeoutMs: 30_000, maxRetries: 1 }
  );
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`VoiceStudio profile create failed (${createRes.status}): ${errText.slice(0, 300)}`);
  }
  const profile = (await createRes.json()) as { id?: string; voice_id?: string };
  const profileId = profile.id || profile.voice_id || '';
  if (!profileId) {
    throw new Error('VoiceStudio did not return a profile ID.');
  }

  const consentForm = new FormData();
  consentForm.append(
    'consent_text',
    'I confirm this is my own voice and authorize Kraya and VoiceStudio to synthesize procurement voice notes on my behalf.'
  );
  consentForm.append(
    'consent_audio',
    new Blob([new Uint8Array(params.wavBytes)], { type: 'audio/wav' }),
    'consent.wav'
  );
  await fetch(`${base}/profiles/${encodeURIComponent(profileId)}/consent`, {
    method: 'POST',
    headers,
    body: consentForm,
  }).catch(() => {});

  return { profileId };
}
