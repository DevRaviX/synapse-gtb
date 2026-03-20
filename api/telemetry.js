module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ metrics: [], message: 'No telemetry on serverless deployment' });
};
