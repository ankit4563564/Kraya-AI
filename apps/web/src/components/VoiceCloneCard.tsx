import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Upload, CheckCircle2, AlertTriangle, Volume2 } from 'lucide-react';
import { API_BASE, apiJson, getStoredAuthToken, OutreachLang } from '../lib/api';

interface VoiceStatusResponse {
  baseUrl: string;
  reachable: boolean;
  defaultVoiceId: string | null;
  voiceMap: Record<string, string>;
  masteredLanguages: string[];
  calibrationScripts: Record<string, string>;
}

interface VoiceCloneResult {
  ok: boolean;
  language: string;
  masteredWithFfmpeg: boolean;
  masteredWavPath: string;
  referenceAudioUrl: string;
  voiceStudioReachable: boolean;
  voiceStudioSynced: boolean;
  profileId: string | null;
  voiceMap: Record<string, string>;
  syncError: string | null;
}

const DEFAULT_SCRIPTS: Record<string, string> = {
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

export function VoiceCloneCard({ initialLanguage = 'hinglish' }: { initialLanguage?: OutreachLang }) {
  const [lang, setLang] = useState<OutreachLang>(initialLanguage);
  const [status, setStatus] = useState<VoiceStatusResponse | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mastering, setMastering] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCloneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStatus = () => {
    apiJson<VoiceStatusResponse>('/api/voice/status')
      .then(setStatus)
      .catch(() => {});
  };

  useEffect(() => {
    refreshStatus();
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  const scriptText =
    status?.calibrationScripts?.[lang] || DEFAULT_SCRIPTS[lang] || DEFAULT_SCRIPTS.hinglish;

  const uploadAndMasterBlob = async (blob: Blob, fileName: string) => {
    setMastering(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('audio', blob, fileName);
      form.append('language', lang);
      form.append('refText', scriptText);

      const token = getStoredAuthToken();
      const res = await fetch(`${API_BASE}/api/voice/clone`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as VoiceCloneResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Voice cloning failed (${res.status})`);
      }
      setLastResult(data);
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process voice recording');
    } finally {
      setMastering(false);
    }
  };

  const handleStartRecording = async () => {
    setError(null);
    setLastResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          void uploadAndMasterBlob(blob, `mic-${lang}.webm`);
        }
      };

      recorder.start();
      setRecording(true);
      setElapsedSec(0);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => {
          const next = prev + 1;
          if (next >= 11 && recorderRef.current && recorderRef.current.state === 'recording') {
            recorderRef.current.stop();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Microphone access failed: ${err.message}`
          : 'Could not access microphone.'
      );
    }
  };

  const handleStopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const hasMasteredForLang = Boolean(
    status?.masteredLanguages?.includes(lang) || lastResult?.language === lang
  );
  const clonedProfileForLang = status?.voiceMap?.[lang] || status?.voiceMap?.default || null;

  return (
    <div className="card" style={{ padding: 12, background: 'var(--bg-app)', fontSize: 12, marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>Own-Voice Cloning Studio (VoiceStudio · ₹0 Local Engine)</strong>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
            Record 10 seconds below. Kraya automatically cleans rumble/noise via <code>ffmpeg</code> (24 kHz mono, -16 LUFS) and clones your voice.
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span
            className="pill"
            style={{
              fontSize: 11,
              color: status?.reachable ? 'var(--success)' : 'var(--text-secondary)',
            }}
          >
            {status?.reachable
              ? `VoiceStudio Online (${clonedProfileForLang ? `Clone: ${clonedProfileForLang.slice(0, 10)}` : 'Ready'})`
              : 'VoiceStudio Offline (:3900)'}
          </span>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <select
          aria-label="Voice clone language"
          value={lang}
          onChange={(e) => setLang(e.target.value as OutreachLang)}
          style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }}
        >
          <option value="hinglish">Hinglish (Code-Mixed)</option>
          <option value="english">Business English</option>
          <option value="hindi">हिन्दी (Hindi)</option>
          <option value="kannada">ಕನ್ನಡ (Kannada)</option>
          <option value="tamil">தமிழ் (Tamil)</option>
          <option value="malayalam">മലയാളം (Malayalam)</option>
        </select>

        {!recording ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={mastering}
            onClick={handleStartRecording}
          >
            <Mic size={13} />
            {mastering ? 'Mastering & Cloning...' : 'Record 10s Reference from Mic'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={handleStopRecording}
          >
            <Square size={13} />
            Stop Recording ({elapsedSec}s / 10s)
          </button>
        )}

        <button
          type="button"
          className="btn btn-sm"
          disabled={recording || mastering}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={13} /> Upload Voice Memo (.m4a/.wav)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadAndMasterBlob(f, f.name);
            e.target.value = '';
          }}
        />
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px dashed var(--border)',
          background: 'var(--bg-surface)',
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
          Read this line naturally at your normal vendor-call pace while recording:
        </div>
        <div style={{ fontWeight: 500, fontSize: 12.5 }}>&ldquo;{scriptText}&rdquo;</div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 8,
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {lastResult && (
        <div
          style={{
            marginTop: 8,
            color: lastResult.voiceStudioSynced ? 'var(--success)' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <CheckCircle2 size={13} />
          {lastResult.voiceStudioSynced
            ? `Cloned & registered in VoiceStudio (Profile ID: ${lastResult.profileId})!`
            : `Studio-mastered 24 kHz WAV saved (${lastResult.masteredWavPath}). Start VoiceStudio on :3900 to sync.`}
        </div>
      )}

      {hasMasteredForLang && (
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <Volume2 size={14} />
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Mastered {lang} reference:
          </span>
          <audio
            controls
            src={`${API_BASE}${lastResult?.referenceAudioUrl || `/api/voice/reference/${lang}`}`}
            style={{ height: 30, flex: 1 }}
          />
        </div>
      )}
    </div>
  );
}
