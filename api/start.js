const { getSupabase } = require('./_supabase');
const {
  DEFAULT_CAMERA_MODE,
  ZERO_HASH,
  buildChainHash,
  buildFrameHash,
  buildFrameInsert,
  buildVitals,
  createSessionId,
  encodeMeta,
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

  const patientId = body.patient_id || body.patientId || 'P-2718';
  const sessionId = createSessionId();
  const cameraMode = DEFAULT_CAMERA_MODE;
  const startedAt = new Date();
  const initialVitals = buildVitals(0);
  const initialFrameHash = buildFrameHash(sessionId, 0);
  const initialChainHash = buildChainHash({
    seq: 0,
    timestamp: 1,
    frame_sha256: initialFrameHash,
    vitals: initialVitals,
    prev_hash: ZERO_HASH,
  });

  const { error } = await sb.from('ot_blocks').insert([
    {
      patient_id: patientId,
      bp: 118,
      spo2: 98,
      heart_rate: 76,
      prev_hash: encodeMeta({
        sid: sessionId,
        evt: 'start',
        seq: -1,
        prev: ZERO_HASH,
        ts: 0,
        cam: cameraMode,
      }),
      curr_hash: ZERO_HASH,
      recorded_at: startedAt.toISOString(),
    },
    {
      ...buildFrameInsert({
        sessionId,
        patientId,
        cameraMode,
        seq: 0,
        prevHash: ZERO_HASH,
        timestamp: 1,
        vitals: initialVitals,
        chainHash: initialChainHash,
      }),
      recorded_at: new Date(startedAt.getTime() + 1).toISOString(),
    },
  ]);

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to start Sentinel session' });
  }

  return res.status(200).json({
    session_id: sessionId,
    patient_id: patientId,
    camera_mode: cameraMode,
    message: 'Cloud Sentinel session started and is persisting to Supabase.',
  });
};
