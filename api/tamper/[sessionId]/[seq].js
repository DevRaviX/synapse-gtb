const crypto = require('crypto');
const { getSupabase } = require('../../_supabase');
const {
  encodeMeta,
  fetchSessionRows,
  getSessionFrames,
} = require('../../_sentinel');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { sessionId, seq } = req.query;
  const targetSeq = Number(seq);
  const mode = req.query.mode || 'modify_vitals';

  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: 'Supabase not configured' });

  const sessionRows = await fetchSessionRows(sb, sessionId);
  const frames = getSessionFrames(sessionRows);
  const target = frames.find((frame) => frame.seq === targetSeq);

  if (!target) {
    return res.status(404).json({ error: `Frame ${targetSeq} not found in session '${sessionId}'` });
  }

  let updates = {};

  if (mode === 'modify_vitals') {
    updates = {
      heart_rate: target.vitals.hr + 20,
      bp: target.vitals.bp_sys + 8,
      spo2: Math.max(85, target.vitals.spo2 - 2),
    };
  } else if (mode === 'modify_frame') {
    updates = {
      curr_hash: crypto.randomBytes(32).toString('hex'),
    };
  } else if (mode === 'delete_frame') {
    updates = {
      prev_hash: encodeMeta({
        sid: sessionId,
        evt: 'deleted',
        seq: target.seq,
        prev: target.prev_hash,
        ts: target.timestamp,
        cam: target.camera_mode,
      }),
    };
  } else if (mode === 'reorder') {
    updates = {
      prev_hash: encodeMeta({
        sid: sessionId,
        evt: 'frame',
        seq: target.seq + 1,
        prev: target.prev_hash,
        ts: target.timestamp,
        cam: target.camera_mode,
      }),
    };
  } else {
    return res.status(400).json({ error: `Unsupported tamper mode '${mode}'` });
  }

  const { error } = await sb
    .from('ot_blocks')
    .update(updates)
    .eq('block_id', target.block_id);

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to tamper session' });
  }

  return res.json({
    ok: true,
    session_id: sessionId,
    seq: targetSeq,
    mode,
    message: 'Tamper applied.',
  });
};
