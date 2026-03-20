const { getSupabase } = require('./_supabase');
const {
  DEFAULT_CAMERA_MODE,
  ZERO_HASH,
  encodeMeta,
  fetchAllSentinelRows,
  fetchSessionRows,
  getActiveSessionSummary,
  getSessionEvents,
  getSessionFrames,
} = require('./_sentinel');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const body = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {});

  let sessionId = body.session_id || body.sessionId || null;
  if (!sessionId) {
    const active = getActiveSessionSummary(await fetchAllSentinelRows(sb));
    sessionId = active?.session_id || null;
  }

  if (!sessionId) {
    return res.status(404).json({ error: 'No active Sentinel session found' });
  }

  const sessionRows = await fetchSessionRows(sb, sessionId);
  if (!sessionRows.length) {
    return res.status(404).json({ error: `Session '${sessionId}' not found` });
  }

  const events = getSessionEvents(sessionRows);
  const frames = getSessionFrames(sessionRows);
  const stopEvent = [...events].reverse().find(({ meta }) => meta.evt === 'stop');
  const startEvent = events.find(({ meta }) => meta.evt === 'start') || events[0];
  const patientId = startEvent.row.patient_id;
  const cameraMode = startEvent.meta.cam || DEFAULT_CAMERA_MODE;
  const lastFrame = frames[frames.length - 1] || null;

  if (!stopEvent) {
    const { error } = await sb.from('ot_blocks').insert({
      patient_id: patientId,
      bp: lastFrame?.vitals?.bp_sys || startEvent.row.bp || 118,
      spo2: lastFrame?.vitals?.spo2 || startEvent.row.spo2 || 98,
      heart_rate: lastFrame?.vitals?.hr || startEvent.row.heart_rate || 76,
      prev_hash: encodeMeta({
        sid: sessionId,
        evt: 'stop',
        seq: lastFrame?.seq ?? -1,
        prev: lastFrame?.chain_hash || ZERO_HASH,
        ts: lastFrame?.timestamp || 0,
        cam: cameraMode,
      }),
      curr_hash: lastFrame?.chain_hash || ZERO_HASH,
      recorded_at: new Date().toISOString(),
    });

    if (error) {
      return res.status(500).json({ error: error.message || 'Failed to stop Sentinel session' });
    }
  }

  return res.status(200).json({
    status: 'stopped',
    session_id: sessionId,
    patient_id: patientId,
    camera_mode: cameraMode,
    total_records: frames.length,
    final_hash: lastFrame?.chain_hash || ZERO_HASH,
    total_elapsed: lastFrame?.timestamp || 0,
    vitals: lastFrame?.vitals || null,
    records: frames,
    message: 'Sentinel session sealed and stored in Supabase.',
  });
};
