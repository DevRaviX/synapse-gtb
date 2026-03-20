
module.exports = (req, res) => {
  // Always say a session is ready for virtual interaction
  // Or say running: false, which is default.
  // We'll return running: true for a brief period if needed, 
  // but for serverless we can't maintain state across requests without a DB.
  
  res.status(200).json({ 
    running: false, 
    session_id: null,
    message: "Sentinel is on standby."
  });
};
