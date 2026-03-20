const { getSupabase } = require('./_supabase');
const {
  fetchAllSentinelRows,
  getActiveSessionSummary,
} = require('./_sentinel');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sb = getSupabase();
  if (!sb) {
    return res.status(200).json({
      running: false,
      session_id: null,
      message: 'Supabase not configured.',
    });
  }

  const rows = await fetchAllSentinelRows(sb);
  const active = getActiveSessionSummary(rows);

  if (!active) {
    return res.status(200).json({
      running: false,
      session_id: null,
      message: 'Sentinel is on standby.',
    });
  }

  return res.status(200).json({
    running: true,
    session_id: active.session_id,
    patient_id: active.patient_id,
    camera_mode: active.camera_mode,
    records: active.records,
    final_hash: active.final_hash,
    message: 'Cloud Sentinel session is active.',
  });
};
