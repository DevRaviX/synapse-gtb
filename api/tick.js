const { getSupabase } = require('./_supabase');
const {
  DEFAULT_CAMERA_MODE,
  ZERO_HASH,
  buildChainHash,
  buildFrameHash,
  buildFrameInsert,
  buildVitals,
  fetchSessionRows,
  getSessionEvents,
  getSessionFrames,
} = require('./_sentinel');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const body = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {});
  const sessionId = body.session_id || body.sessionId;

  if (!sessionId) {
    return res.status(400).json({ error: 'session_id required' });
  }

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const sessionRows = await fetchSessionRows(sb, sessionId);
  if (!sessionRows.length) {
    return res.status(404).json({ error: `Session '${sessionId}' not found` });
  }

  const events = getSessionEvents(sessionRows);
  const frames = getSessionFrames(sessionRows);
  const stopEvent = [...events].reverse().find(({ meta }) => meta.evt === 'stop');
  if (stopEvent) {
    const lastFrame = frames[frames.length - 1] || null;
    return res.status(409).json({
      error: 'Session already sealed',
      session_id: sessionId,
      seq: lastFrame?.seq ?? -1,
      chain_hash: lastFrame?.chain_hash || ZERO_HASH,
    });
  }

  const startEvent = events.find(({ meta }) => meta.evt === 'start') || events[0];
  const patientId = startEvent.row.patient_id;
  const cameraMode = startEvent.meta.cam || DEFAULT_CAMERA_MODE;
  const nextSeq = frames.length;
  const timestamp = nextSeq + 1;
  const prevHash = frames[frames.length - 1]?.chain_hash || ZERO_HASH;
  const vitals = buildVitals(nextSeq);
  const frame_sha256 = buildFrameHash(sessionId, nextSeq);
  const chain_hash = buildChainHash({
    seq: nextSeq,
    timestamp,
    frame_sha256,
    vitals,
    prev_hash: prevHash,
  });

  const insertPayload = buildFrameInsert({
    sessionId,
    patientId,
    cameraMode,
    seq: nextSeq,
    prevHash,
    timestamp,
    vitals,
    chainHash: chain_hash,
  });

  const { error } = await sb.from('ot_blocks').insert(insertPayload);
  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to persist tick' });
  }

  return res.status(200).json({
    type: 'chain_update',
    session_id: sessionId,
    seq: nextSeq,
    vitals,
    chain_hash,
    prev_hash: prevHash,
    frame_sha256,
    elapsed: timestamp,
    batch_count: Math.ceil((nextSeq + 1) / 10),
    camera_mode: cameraMode,
  });
};
