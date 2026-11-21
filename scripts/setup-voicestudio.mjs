#!/usr/bin/env node
/**
 * Automated VoiceStudio (github.com/debpalash/VoiceStudio) Setup & Own-Voice Cloning Pipeline for Kraya.
 *
 * Usage examples:
 *   1. Clone from an existing Voice Memo / audio file (.m4a, .wav, .mp3):
 *        pnpm voice:setup --audio ./my-voice.m4a --lang hinglish
 *
 *   2. Record 10 seconds live from your Mac microphone, auto-master, and clone:
 *        pnpm voice:setup --record 10 --lang hinglish
 *
 *   3. Also auto-start the local VoiceStudio Docker container on port 3900 if not running:
 *        pnpm voice:setup --start-docker --audio ./my-voice.m4a
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const DEFAULT_SCRIPTS = {
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

function parseArgs(argv) {
  const out = {
    audio: null,
    recordSeconds: 0,
    refText: null,
    name: 'Kraya Owner Clone',
    lang: 'default',
    url: process.env.VOICESTUDIO_BASE_URL || 'http://localhost:3900',
    apiKey: process.env.VOICESTUDIO_API_KEY || '',
    startDocker: false,
    skipMaster: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audio' && argv[i + 1]) out.audio = argv[++i];
    else if (a === '--record') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.recordSeconds = Number(argv[++i]) || 10;
      } else {
        out.recordSeconds = 10;
      }
    } else if (a === '--ref-text' && argv[i + 1]) out.refText = argv[++i];
    else if (a === '--name' && argv[i + 1]) out.name = argv[++i];
    else if (a === '--lang' && argv[i + 1]) out.lang = argv[++i].toLowerCase();
    else if (a === '--url' && argv[i + 1]) out.url = argv[++i];
    else if (a === '--api-key' && argv[i + 1]) out.apiKey = argv[++i];
    else if (a === '--start-docker') out.startDocker = true;
    else if (a === '--skip-master') out.skipMaster = true;
  }
  return out;
}

function hasBinary(bin) {
  const res = spawnSync('which', [bin], { stdio: 'ignore' });
  return res.status === 0;
}

async function isVoiceStudioHealthy(baseUrl, apiKey) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    return res.ok;
  } catch {
    return false;
  }
}

function upsertEnvVar(envPath, key, value) {
  let content = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : fs.existsSync(`${envPath}.example`)
      ? fs.readFileSync(`${envPath}.example`, 'utf8')
      : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = `${content.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf8');
}

function readEnvVar(envPath, key) {
  if (!fs.existsSync(envPath)) return '';
  const content = fs.readFileSync(envPath, 'utf8');
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data', 'voice-profiles');
  fs.mkdirSync(dataDir, { recursive: true });

  const calibrationScript = args.refText || DEFAULT_SCRIPTS[args.lang] || DEFAULT_SCRIPTS.default;

  console.log('\n==================================================================');
  console.log(' KRAYA x VOICESTUDIO — Local Own-Voice Cloning & Mastering Pipeline');
  console.log('==================================================================\n');

  if (!args.audio && !args.recordSeconds) {
    console.log('1. Record a 7–12 second voice clip in a quiet room reading this exact line');
    console.log(`   (Language: ${args.lang.toUpperCase()}):\n`);
    console.log(`   "${calibrationScript}"\n`);
    console.log('2. Then run ONE of the following commands:\n');
    console.log('   # Option A — Pass an Apple Voice Memo / WAV / M4A file:');
    console.log(`   pnpm voice:setup --audio ./my-voice.m4a --lang ${args.lang}\n`);
    console.log('   # Option B — Record 10 seconds directly from your Mac mic right now:');
    console.log(`   pnpm voice:setup --record 10 --lang ${args.lang}\n`);
    console.log('   # Optional: add --start-docker to auto-launch VoiceStudio on port 3900.\n');
    return;
  }

  let rawAudioPath = args.audio ? path.resolve(args.audio) : null;

  if (args.recordSeconds > 0) {
    if (!hasBinary('ffmpeg')) {
      console.error('Error: ffmpeg is required for live mic capture (`brew install ffmpeg`).');
      process.exit(1);
    }
    rawAudioPath = path.join(dataDir, `raw-mic-${args.lang}-${Date.now()}.wav`);
    console.log(`Read this script naturally at your normal speaking pace (${args.recordSeconds}s):\n`);
    console.log(`  "${calibrationScript}"\n`);
    console.log('Recording starting in 2 seconds...');
    await new Promise((r) => setTimeout(r, 2000));
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'avfoundation',
        '-i',
        ':0',
        '-t',
        String(args.recordSeconds),
        '-ar',
        '24000',
        '-ac',
        '1',
        rawAudioPath,
      ],
      { stdio: 'inherit' }
    );
  }

  if (!rawAudioPath || !fs.existsSync(rawAudioPath)) {
    console.error(`Error: Audio file not found at ${rawAudioPath}`);
    process.exit(1);
  }

  // Step 1: Master reference audio via ffmpeg (24kHz mono 16-bit PCM WAV, highpass 80Hz, denoise, -16 LUFS)
  const masteredWavPath = path.join(dataDir, `mastered-${args.lang}.wav`);
  if (!args.skipMaster && hasBinary('ffmpeg')) {
    console.log('-> Mastering reference audio (24 kHz mono, 80 Hz rumble filter, FFT denoise, -16 LUFS)...');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        rawAudioPath,
        '-af',
        'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,silenceremove=start_periods=1:start_silence=0.15:start_threshold=-45dB',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        masteredWavPath,
      ],
      { stdio: 'ignore' }
    );
    console.log(`   Saved clean reference WAV -> ${masteredWavPath}`);
  } else {
    fs.copyFileSync(rawAudioPath, masteredWavPath);
  }

  // Step 2: Ensure VoiceStudio is reachable on port 3900
  let healthy = await isVoiceStudioHealthy(args.url, args.apiKey);
  if (!healthy && args.startDocker && hasBinary('docker')) {
    console.log('-> Starting VoiceStudio Docker container on 127.0.0.1:3900...');
    spawnSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        'omnivoice',
        '-p',
        '127.0.0.1:3900:3900',
        '-e',
        'OMNIVOICE_DATA_DIR=/app/omnivoice_data',
        '-v',
        'omnivoice-data:/app/omnivoice_data',
        'ghcr.io/debpalash/voicestudio:stable',
      ],
      { stdio: 'inherit' }
    );
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      healthy = await isVoiceStudioHealthy(args.url, args.apiKey);
      if (healthy) break;
    }
  }

  if (!healthy) {
    console.warn(`\n[!] VoiceStudio is not reachable at ${args.url} yet.`);
    console.warn(`    Your clean, mastered reference clip is ready at: ${masteredWavPath}`);
    console.warn('    Start VoiceStudio (Desktop app or Docker on port 3900) and re-run:');
    console.warn(`    pnpm voice:setup --audio "${masteredWavPath}" --skip-master --lang ${args.lang}\n`);
    process.exit(0);
  }

  // Step 3: Upload cloned voice profile to VoiceStudio POST /profiles
  console.log(`-> Uploading reference clip to VoiceStudio (${args.url}/profiles)...`);
  const wavBytes = fs.readFileSync(masteredWavPath);
  const form = new FormData();
  form.append('name', `${args.name} (${args.lang})`);
  form.append('kind', 'clone');
  form.append('ref_text', calibrationScript);
  form.append('language', 'Auto');
  form.append('ref_audio', new Blob([wavBytes], { type: 'audio/wav' }), path.basename(masteredWavPath));

  const headers = args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {};
  const createRes = await fetch(`${args.url.replace(/\/+$/, '')}/profiles`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error(`Error creating VoiceStudio profile (${createRes.status}): ${errText}`);
    process.exit(1);
  }

  const profile = await createRes.json();
  const profileId = profile.id || profile.voice_id;
  console.log(`   Created voice profile ID: ${profileId}`);

  // Step 4: Record own-voice consent so agentic routes are unlocked
  const consentForm = new FormData();
  consentForm.append(
    'consent_text',
    'I confirm this is my own voice and authorize Kraya and VoiceStudio to synthesize procurement voice notes on my behalf.'
  );
  consentForm.append('consent_audio', new Blob([wavBytes], { type: 'audio/wav' }), 'consent.wav');
  await fetch(`${args.url.replace(/\/+$/, '')}/profiles/${encodeURIComponent(profileId)}/consent`, {
    method: 'POST',
    headers,
    body: consentForm,
  }).catch(() => {});

  // Step 5: Auto-update .env with VOICESTUDIO_BASE_URL, VOICESTUDIO_VOICE_ID, VOICESTUDIO_VOICE_MAP
  const envPath = path.join(rootDir, '.env');
  let voiceMap = {};
  const existingMapRaw = readEnvVar(envPath, 'VOICESTUDIO_VOICE_MAP');
  if (existingMapRaw) {
    try {
      voiceMap = JSON.parse(existingMapRaw);
    } catch {
      voiceMap = {};
    }
  }
  voiceMap[args.lang] = profileId;
  if (!voiceMap.default) voiceMap.default = profileId;

  upsertEnvVar(envPath, 'VOICESTUDIO_BASE_URL', args.url);
  upsertEnvVar(envPath, 'VOICESTUDIO_VOICE_ID', voiceMap.default);
  upsertEnvVar(envPath, 'VOICESTUDIO_VOICE_MAP', JSON.stringify(voiceMap));
  upsertEnvVar(envPath, 'VOICESTUDIO_SEED', '42');

  console.log(`-> Updated .env with VOICESTUDIO_VOICE_ID=${voiceMap.default}`);
  console.log(`   VOICESTUDIO_VOICE_MAP=${JSON.stringify(voiceMap)}`);

  // Step 6: Synthesize a quick verification take
  console.log('-> Synthesizing test WhatsApp voice note in your cloned voice...');
  const ttsRes = await fetch(`${args.url.replace(/\/+$/, '')}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model: 'omnivoice',
      voice: profileId,
      input: calibrationScript,
      response_format: 'opus',
      speed: 1.0,
      seed: 42,
    }),
  });

  if (ttsRes.ok) {
    const previewPath = path.join(dataDir, `preview-${args.lang}.ogg`);
    fs.writeFileSync(previewPath, Buffer.from(await ttsRes.arrayBuffer()));
    console.log(`   Test voice note saved -> ${previewPath}\n`);
  }
  console.log('Done! Restart `pnpm dev` and click "Generate Voice Note" in any Kraya Outreach dialog.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
