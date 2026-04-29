// Standalone fetcher — calls ElevenLabs /v1/user/subscription and prints JSON.
const https = require('https');
const path = require('path');
const fs = require('fs');

function loadApiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    if (cfg && typeof cfg.elevenLabsApiKey === 'string' && cfg.elevenLabsApiKey.trim()) {
      return cfg.elevenLabsApiKey.trim();
    }
  } catch {}
  return null;
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('invalid JSON')); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    process.stdout.write(JSON.stringify({ error: 'no api key' }));
    process.exit(0);
  }

  try {
    const sub = await get('https://api.elevenlabs.io/v1/user/subscription', {
      'xi-api-key': apiKey,
      'Accept': 'application/json',
    });

    const used  = Number(sub.character_count) || 0;
    const limit = Number(sub.character_limit) || 0;
    const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null;

    const data = {
      tier: sub.tier || null,
      status: sub.status || null,
      characters: { used, limit, pct },
      voices: {
        used: typeof sub.voice_slots_used === 'number' ? sub.voice_slots_used : null,
        limit: typeof sub.voice_limit === 'number' ? sub.voice_limit : null,
      },
      professionalVoices: {
        used: typeof sub.professional_voice_slots_used === 'number' ? sub.professional_voice_slots_used : null,
        limit: typeof sub.professional_voice_limit === 'number' ? sub.professional_voice_limit : null,
      },
      resetUnix: typeof sub.next_character_count_reset_unix === 'number'
        ? sub.next_character_count_reset_unix
        : null,
      canExtendCharacterLimit: !!sub.can_extend_character_limit,
      allowedToExtendCharacterLimit: !!sub.allowed_to_extend_character_limit,
    };

    process.stdout.write(JSON.stringify(data));
    process.exit(0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message || 'fetch failed' }));
    process.exit(0);
  }
}

main();
