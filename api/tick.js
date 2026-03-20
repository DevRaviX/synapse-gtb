
module.exports = (req, res) => {
  const { session_id } = req.body || {};
  
  if (!session_id) {
    return res.status(400).json({ error: "session_id required" });
  }

  // Generate mock vitals that fluctuate slightly
  const now = Date.now();
  const hr = 70 + Math.floor(Math.random() * 10);
  const spo2 = 97 + Math.floor(Math.random() * 3);
  const bp_sys = 115 + Math.floor(Math.random() * 15);
  const bp_dia = Math.floor(bp_sys * 0.7);

  // Mock seq based on timestamp or just random increment
  const seq = Math.floor(now / 1000) % 10000;

  res.status(200).json({
    type: 'chain_update',
    session_id,
    seq,
    vitals: { hr, spo2, bp_sys, bp_dia },
    chain_hash: "0x" + Math.random().toString(16).slice(2, 66),
    prev_hash: "0x" + Math.random().toString(16).slice(2, 66),
    frame_sha256: "0x" + Math.random().toString(16).slice(2, 66),
    elapsed: Math.floor(now / 1000) % 3600,
    batch_count: Math.floor(seq / 10)
  });
};
