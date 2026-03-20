const crypto = require('crypto');

const ZERO_HASH = '0'.repeat(64);
const DEFAULT_CAMERA_MODE = 'cloud-demo';
const BATCH_SIZE = 10;

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createSessionId() {
  return `sentinel-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function encodeMeta(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/[|\n\r]/g, '_')}`)
    .join('|');
}

function parseMeta(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('sid=')) {
    return {};
  }

  return value.split('|').reduce((acc, part) => {
    const [key, ...rest] = part.split('=');
    if (!key || rest.length === 0) return acc;
    acc[key] = rest.join('=');
    return acc;
  }, {});
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildVitals(seq) {
  const phase = seq / 5;
  const hr = Math.round(76 + Math.sin(phase) * 8 + (seq % 9 === 0 ? 3 : 0));
  const spo2 = Math.max(93, Math.min(100, Number((98 - Math.abs(Math.cos(phase / 2)) * 1.8 - (seq % 15 === 0 ? 0.4 : 0)).toFixed(1))));
  const bp_sys = Math.round(118 + Math.cos(phase / 1.7) * 9 + (seq % 11 === 0 ? 2 : 0));
  const bp_dia = Math.round(bp_sys * 0.68);

  return { hr, spo2, bp_sys, bp_dia };
}

function buildFrameHash(sessionId, seq) {
  return sha256(`cloud-demo-frame:${sessionId}:${seq}:project-sentinel`);
}

function buildChainHash({ seq, timestamp, frame_sha256, vitals, prev_hash }) {
  return sha256(stableStringify({
    seq,
    ts: timestamp,
    frame_sha256,
    vitals,
    prev_hash,
  }));
}

async function fetchSessionRows(sb, sessionId) {
  if (!sb) return [];

  const { data, error } = await sb
    .from('ot_blocks')
    .select('*')
    .like('prev_hash', `sid=${sessionId}|%`)
    .order('recorded_at', { ascending: true })
    .limit(2000);

  if (error || !data) return [];
  return data;
}

async function fetchAllSentinelRows(sb) {
  if (!sb) return [];

  const { data, error } = await sb
    .from('ot_blocks')
    .select('*')
    .like('prev_hash', 'sid=%')
    .order('recorded_at', { ascending: true })
    .limit(2000);

  if (error || !data) return [];
  return data;
}

function normalizeRows(rows) {
  return (rows || [])
    .map((row) => ({ row, meta: parseMeta(row.prev_hash) }))
    .filter(({ meta }) => meta.sid);
}

function getSessionFrames(rows) {
  return normalizeRows(rows)
    .filter(({ meta }) => meta.evt === 'frame')
    .sort((a, b) => toNumber(a.meta.seq) - toNumber(b.meta.seq) || new Date(a.row.recorded_at) - new Date(b.row.recorded_at))
    .map(({ row, meta }) => {
      const seq = toNumber(meta.seq);
      const timestamp = toNumber(meta.ts, seq + 1);
      const vitals = {
        hr: toNumber(row.heart_rate),
        spo2: toNumber(row.spo2),
        bp_sys: toNumber(row.bp),
        bp_dia: Math.round(toNumber(row.bp) * 0.68),
      };

      return {
        block_id: row.block_id,
        patient_id: row.patient_id,
        session_id: meta.sid,
        seq,
        timestamp,
        prev_hash: meta.prev || ZERO_HASH,
        frame_sha256: buildFrameHash(meta.sid, seq),
        vitals,
        chain_hash: row.curr_hash,
        data_hash: row.curr_hash,
        frame_idx: seq,
        camera_mode: meta.cam || DEFAULT_CAMERA_MODE,
        recorded_at: row.recorded_at,
      };
    });
}

function getSessionEvents(rows) {
  return normalizeRows(rows)
    .sort((a, b) => new Date(a.row.recorded_at) - new Date(b.row.recorded_at));
}

function summarizeSession(rows) {
  const events = getSessionEvents(rows);
  if (!events.length) return null;

  const frames = getSessionFrames(rows);
  const startEvent = events.find(({ meta }) => meta.evt === 'start') || events[0];
  const stopEvent = [...events].reverse().find(({ meta }) => meta.evt === 'stop') || null;
  const lastFrame = frames[frames.length - 1] || null;
  const sessionId = startEvent.meta.sid;

  return {
    session_id: sessionId,
    patient_id: startEvent.row.patient_id,
    camera_mode: startEvent.meta.cam || lastFrame?.camera_mode || DEFAULT_CAMERA_MODE,
    records: frames.length,
    batches: Math.ceil(frames.length / BATCH_SIZE),
    genesis_hash: frames[0]?.prev_hash || ZERO_HASH,
    final_hash: lastFrame?.chain_hash || ZERO_HASH,
    running: !stopEvent,
    created_at: startEvent.row.recorded_at,
    updated_at: (stopEvent?.row.recorded_at || lastFrame?.recorded_at || startEvent.row.recorded_at),
  };
}

function groupRowsBySession(rows) {
  const grouped = new Map();

  for (const entry of normalizeRows(rows)) {
    const sessionId = entry.meta.sid;
    if (!grouped.has(sessionId)) grouped.set(sessionId, []);
    grouped.get(sessionId).push(entry.row);
  }

  return grouped;
}

function getActiveSessionSummary(rows) {
  const grouped = groupRowsBySession(rows);
  const running = [];

  for (const sessionRows of grouped.values()) {
    const summary = summarizeSession(sessionRows);
    if (summary?.running) running.push(summary);
  }

  running.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return running[0] || null;
}

function buildFrameInsert({ sessionId, patientId, cameraMode, seq, prevHash, timestamp, vitals, chainHash }) {
  return {
    patient_id: patientId,
    bp: vitals.bp_sys,
    spo2: vitals.spo2,
    heart_rate: vitals.hr,
    prev_hash: encodeMeta({
      sid: sessionId,
      evt: 'frame',
      seq,
      prev: prevHash,
      ts: timestamp,
      cam: cameraMode,
    }),
    curr_hash: chainHash,
    recorded_at: new Date().toISOString(),
  };
}

module.exports = {
  BATCH_SIZE,
  DEFAULT_CAMERA_MODE,
  ZERO_HASH,
  buildChainHash,
  buildFrameHash,
  buildFrameInsert,
  buildVitals,
  createSessionId,
  encodeMeta,
  fetchAllSentinelRows,
  fetchSessionRows,
  getActiveSessionSummary,
  getSessionEvents,
  getSessionFrames,
  groupRowsBySession,
  parseMeta,
  sha256,
  summarizeSession,
  toNumber,
};
