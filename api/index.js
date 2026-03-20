import { createClient } from '@supabase/supabase-js';

let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  }
  return supabase;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse the path after /api/
  const path = req.url.split('?')[0];

  try {
    // ── Health ──
    if (path === '/api/health') {
      return res.json({ ok: true, env: 'vercel', runtime: 'node' });
    }

    // ── Status ──
    if (path === '/api/status') {
      return res.json({
        session_id: null, seq: 0, latest_hash: '', prev_hash: '',
        batches: 0, running: false, camera_mode: 'serverless',
        message: 'Live pipeline unavailable on serverless. Use Demo Mode.',
      });
    }

    // ── Recordings ──
    if (path === '/api/recordings') {
      const sb = getSupabase();
      if (!sb) return res.json([]);
      try {
        const { data: items, error } = await sb.storage.from('sessions').list('');
        if (error || !items) return res.json([]);
        const recordings = [];
        for (const item of items) {
          if (!item.name || item.name.startsWith('.')) continue;
          try {
            const { data: blob } = await sb.storage.from('sessions').download(`${item.name}/manifest.json`);
            if (!blob) continue;
            const text = await blob.text();
            const manifest = JSON.parse(text);
            recordings.push({
              session_id: item.name,
              records: (manifest.records || []).length,
              batches: (manifest.merkle_batches || []).length,
              genesis_hash: manifest.genesis_hash || '',
            });
          } catch { continue; }
        }
        return res.json(recordings);
      } catch (e) {
        return res.json([]);
      }
    }

    // ── Start ──
    if (path === '/api/start') {
      return res.json({
        status: 'unavailable',
        message: 'Recording requires local backend (python -m app.main --with-api). Use Demo Mode on Vercel.',
      });
    }

    // ── Stop ──
    if (path === '/api/stop') {
      return res.json({ status: 'not_running' });
    }

    // ── Verify ──
    if (path.startsWith('/api/verify/')) {
      const sessionId = path.split('/api/verify/')[1];
      const sb = getSupabase();
      if (!sb) return res.status(503).json({ error: 'Supabase not configured' });
      try {
        const { data: blob } = await sb.storage.from('sessions').download(`${sessionId}/manifest.json`);
        if (!blob) return res.status(404).json({ error: 'Session not found' });
        const manifest = JSON.parse(await blob.text());
        const records = manifest.records || [];
        let valid = true, broken_at = null;
        for (let i = 1; i < records.length; i++) {
          if (records[i].prev_hash !== records[i - 1].chain_hash) {
            valid = false;
            broken_at = i;
            break;
          }
        }
        return res.json({ ok: valid, valid, verified_count: records.length, broken_at });
      } catch (e) {
        return res.status(404).json({ error: `Session '${sessionId}' not found` });
      }
    }

    // ── Tamper ──
    if (path.startsWith('/api/tamper/')) {
      return res.json({ status: 'unavailable', message: 'Tamper simulation requires local backend.' });
    }

    // ── Fallback ──
    return res.json({ path, method: req.method, message: 'Synapse GTB API (Vercel/Node)' });

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
