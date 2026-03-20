const { getSupabase } = require('../_supabase');
const {
  ZERO_HASH,
  buildChainHash,
  fetchSessionRows,
  getSessionFrames,
} = require('../_sentinel');

module.exports = async (req, res) => {
  const { sessionId } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: 'Supabase not configured' });

  const sessionRows = await fetchSessionRows(sb, sessionId);
  if (sessionRows.length) {
    const frames = getSessionFrames(sessionRows);
    if (!frames.length) {
      return res.status(404).json({ error: `Session '${sessionId}' has no recorded frames yet` });
    }

    let expectedPrev = ZERO_HASH;

    for (let idx = 0; idx < frames.length; idx += 1) {
      const frame = frames[idx];
      const expectedSeq = idx;

      if (frame.seq !== expectedSeq) {
        return res.json({
          ok: false,
          valid: false,
          verified_count: idx,
          broken_at: frame.seq,
          failed_at: frame.seq,
          reason: 'sequence_gap',
        });
      }

      if (frame.prev_hash !== expectedPrev) {
        return res.json({
          ok: false,
          valid: false,
          verified_count: idx,
          broken_at: frame.seq,
          failed_at: frame.seq,
          reason: 'prev_hash_mismatch',
          expected: expectedPrev,
          got: frame.prev_hash,
        });
      }

      const expectedHash = buildChainHash({
        seq: frame.seq,
        timestamp: frame.timestamp,
        frame_sha256: frame.frame_sha256,
        vitals: frame.vitals,
        prev_hash: frame.prev_hash,
      });

      if (frame.chain_hash !== expectedHash) {
        return res.json({
          ok: false,
          valid: false,
          verified_count: idx,
          broken_at: frame.seq,
          failed_at: frame.seq,
          reason: 'chain_hash_mismatch',
          expected: expectedHash,
          got: frame.chain_hash,
        });
      }

      expectedPrev = frame.chain_hash;
    }

    return res.json({
      ok: true,
      valid: true,
      verified_count: frames.length,
      broken_at: null,
      failed_at: null,
      final_hash: expectedPrev,
    });
  }

  try {
    const { data: blob } = await sb.storage.from('sessions').download(`${sessionId}/manifest.json`);
    if (!blob) return res.status(404).json({ error: 'Session not found' });

    const manifest = JSON.parse(await blob.text());
    const records = manifest.records || [];
    let valid = true;
    let broken_at = null;

    for (let i = 1; i < records.length; i += 1) {
      if (records[i].prev_hash !== records[i - 1].chain_hash) {
        valid = false;
        broken_at = i;
        break;
      }
    }

    return res.json({
      ok: valid,
      valid,
      verified_count: records.length,
      broken_at,
      failed_at: broken_at,
    });
  } catch (_) {
    return res.status(404).json({ error: `Session '${sessionId}' not found` });
  }
};
