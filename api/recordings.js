const { getSupabase } = require('./_supabase');
const {
  fetchAllSentinelRows,
  groupRowsBySession,
  summarizeSession,
} = require('./_sentinel');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sb = getSupabase();
  if (!sb) return res.json([]);

  const sentinelRows = await fetchAllSentinelRows(sb);
  if (sentinelRows.length) {
    const grouped = groupRowsBySession(sentinelRows);
    const recordings = [];

    for (const sessionRows of grouped.values()) {
      const summary = summarizeSession(sessionRows);
      if (summary) recordings.push(summary);
    }

    recordings.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return res.json(recordings);
  }

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
      } catch (_) {
        continue;
      }
    }
    return res.json(recordings);
  } catch (_) {
    return res.json([]);
  }
};
