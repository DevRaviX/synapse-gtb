module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ entries: [], message: 'Audit trail is generated locally during recording' });
};
