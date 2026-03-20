
module.exports = (req, res) => {
  const sessionId = "session-" + Math.random().toString(36).substr(2, 9);
  
  // Respond with a dummy session
  res.status(200).json({ 
    session_id: sessionId,
    camera_mode: "webcam",
    message: "Live recording initiated in Virtual Mode (Serverless Fallback)."
  });
};
