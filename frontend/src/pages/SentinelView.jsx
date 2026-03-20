import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import VideoPlayer from '../components/sentinel/VideoPlayer'
import HashMatrix from '../components/sentinel/HashMatrix'
import MagneticTimeline from '../components/sentinel/MagneticTimeline'
import AnomalyLog from '../components/sentinel/AnomalyLog'
import TamperSimulator from '../components/sentinel/TamperSimulator'
import VitalsSync from '../components/sentinel/VitalsSync'
import VerificationPanel from '../components/sentinel/VerificationPanel'
import MerkleTreeViz from '../components/sentinel/MerkleTreeViz'
import HashMetrics from '../components/sentinel/HashMetrics'
import { loadTelemetry, loadAuditTrail, SAMPLE_COMMS } from '../data/sentinelLoader'
import { playBreachAlarm, playAnomalyPing } from '../utils/sounds'
import { Radio, Square, Activity, X } from 'lucide-react'

const API_BASE = 'http://localhost:8000'
const WS_URL = 'ws://localhost:8000/ws/live'

export default function SentinelView() {
  const { doctor } = useAuth()
  
  // ── Mode: "idle" | "live" | "review" | "demo" ──
  const [mode, setMode] = useState('idle')

  // ── Patients State ──
  const [patients, setPatients] = useState([])
  const [showStartModal, setShowStartModal] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [activePatientId, setActivePatientId] = useState(null)

  // ── Review mode state ──
  const [telemetry, setTelemetry] = useState([])
  const [audit, setAudit] = useState([])
  const [comms, setComms] = useState([])
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const videoRef = useRef()

  // ── Live mode state ──
  const [liveSessionId, setLiveSessionId] = useState(null)
  const [liveChain, setLiveChain] = useState([])
  const [liveVitals, setLiveVitals] = useState(null)
  const [liveSeq, setLiveSeq] = useState(0)
  const [liveElapsed, setLiveElapsed] = useState(0)
  const [liveBatchCount, setLiveBatchCount] = useState(0)
  const [liveLatestHash, setLiveLatestHash] = useState('')
  const [cameraMode, setCameraMode] = useState('none')
  const wsRef = useRef(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [reviewFrameIdx, setReviewFrameIdx] = useState(0)
  const reviewTimerRef = useRef(null)

  // ── Tamper state ──
  const [tamperActive, setTamperActive] = useState(false)
  const [validating, setValidating] = useState(false)
  const [tamperInfo, setTamperInfo] = useState(null)
  const [baselineVitals, setBaselineVitals] = useState({
    heart_rate: 72, spo2: 98, bp_sys: 120, motion_score: 0.1
  })

  // Load review data
  useEffect(() => {
    async function load() {
      const tel = await loadTelemetry()
      const aud = await loadAuditTrail()
      setTelemetry(tel)
      setAudit(aud)
      setComms(SAMPLE_COMMS)
      
      const { data } = await supabase.from('patients').select('*').order('id')
      if (data) {
        setPatients(data)
        const initialId = data[0]?.id || ''
        setSelectedPatientId(initialId)
        // Generate pseudo-random baseline
        setBaselineVitals({
          heart_rate: 65 + Math.floor(Math.random() * 20),
          spo2: 97 + Math.floor(Math.random() * 3),
          bp_sys: 110 + Math.floor(Math.random() * 30),
          motion_score: 0.2
        })
      }
    }
    load()
  }, [])

  // Check if backend is already running a session
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/status`)
        if (res.ok) {
          const data = await res.json()
          if (data.running) {
            setMode('live')
            setLiveSessionId(data.session_id)
            setCameraMode(data.camera_mode || 'webcam')
            connectWebSocket()
          }
        }
      } catch (_) {}
    }
    checkStatus()
  }, [])

  // Sync time with video using requestAnimationFrame
  useEffect(() => {
    let raf
    const sync = () => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime)
      }
      raf = requestAnimationFrame(sync)
    }
    raf = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // ── WebSocket connection for live data ──
  const connectWebSocket = useCallback(() => {
    if (wsRef.current) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => console.log('[WS] Connected')

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'chain_update') {
          setLiveSeq(data.seq)
          setLiveVitals(data.vitals)
          setLiveLatestHash(data.chain_hash)
          setLiveElapsed(data.elapsed)
          setLiveBatchCount(data.batch_count)
          setLiveChain(prev => {
            const next = [...prev, {
              seq: data.seq,
              data_hash: data.chain_hash,
              prev_hash: data.prev_hash,
              frame_sha256: data.frame_sha256,
              vitals: data.vitals,
              chain_hash: data.chain_hash,
              timestamp: data.elapsed,
              frame_idx: data.seq,
              session_id: data.session_id,
            }]
            // Keep last 200 entries in memory
            return next.length > 200 ? next.slice(-200) : next
          })
        } else if (data.type === 'session_complete') {
          setMode('review')
          setLiveSessionId(data.session_id)
          setIsPlaying(false)
          setStopping(false)
          
          // Once the operation concludes, save the final hash block for the patient
          if (activePatientId && data.chain_hash) {
            supabase.from('ot_blocks').insert({
              patient_id: activePatientId,
              curr_hash: data.chain_hash,
              bp: data.vitals?.bp_sys, // Storing systolic as main bp for demo
              spo2: data.vitals?.spo2,
              heart_rate: data.vitals?.hr,
              recorded_at: new Date().toISOString()
            }).then(() => console.log('Saved Hash and Vitals to OT Blocks'))
          }
        }
      } catch (_) {}
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected')
      wsRef.current = null
    }

    ws.onerror = () => {
      ws.close()
      wsRef.current = null
    }
  }, [])

  // ── Start Operation ──
  const confirmStartOperation = async () => {
    setShowStartModal(false)
    setStarting(true)
    setActivePatientId(selectedPatientId)
    
    // Virtual Stream Validation Phase
    setValidating(true)
    await new Promise(r => setTimeout(r, 2000)) 
    
    try {
      const res = await fetch(`${API_BASE}/api/start`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setLiveSessionId(data.session_id)
        setCameraMode(data.camera_mode || 'webcam')
        setLiveChain([])
        setLiveSeq(0)
        setLiveElapsed(0)
        setLiveBatchCount(0)
        setLiveLatestHash('')
        setMode('live')
        connectWebSocket()
      }
    } catch (e) {
      console.error('[START] Failed:', e)
    } finally {
      setStarting(false)
      setValidating(false)
    }
  }

  // ── Stop Operation ──
  const handleStop = async () => {
    setStopping(true)
    try {
      await fetch(`${API_BASE}/api/stop`, { method: 'POST' })
      // The session_complete WS message will handle the mode switch
      // We don't clear the liveChain or liveElapsed here so the summary stays visible
    } catch (e) {
      console.error('[STOP] Failed:', e)
      setStopping(false)
    }
  }

  // ── Review mode helpers ──
  const currentFrame = telemetry.find(t => Math.abs(t.timestamp - currentTime) < 0.3) || telemetry[0] || null
  const currentAuditIdx = currentFrame ? currentFrame.frame_idx : 0
  const anomalies = telemetry.filter(t => t.tags && t.tags.length > 0)

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play()
        setIsPlaying(true)
      } else {
        videoRef.current.pause()
        setIsPlaying(false)
      }
    }
  }

  const handleSeek = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const handleJumpToAnomaly = (timestamp) => {
    playAnomalyPing()
    handleSeek(timestamp)
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play()
      setIsPlaying(true)
    }
  }


  // ── Live vitals frame for VitalsSync ──
  const liveFrame = liveVitals ? {
    heart_rate: liveVitals.hr,
    spo2: liveVitals.spo2,
    bp_sys: liveVitals.bp_sys,
    bp_dia: liveVitals.bp_dia,
    tags: [],
    timestamp: liveElapsed,
    frame_idx: liveSeq,
    session_id: liveSessionId,
  } : null

  // ── Review frame from recorded session ──
  const hasRecordedSession = mode === 'review' && liveChain.length > 0 && liveSessionId
  const reviewChainEntry = hasRecordedSession ? liveChain[Math.min(reviewFrameIdx, liveChain.length - 1)] : null
  const reviewFrame = reviewChainEntry ? {
    heart_rate: reviewChainEntry.vitals?.hr,
    spo2: reviewChainEntry.vitals?.spo2,
    bp_sys: reviewChainEntry.vitals?.bp_sys,
    bp_dia: reviewChainEntry.vitals?.bp_dia,
    tags: [],
    timestamp: reviewChainEntry.timestamp,
    frame_idx: reviewChainEntry.seq,
    session_id: liveSessionId,
  } : null

  // Auto-play through recorded frames
  useEffect(() => {
    if (hasRecordedSession && isPlaying) {
      reviewTimerRef.current = setInterval(() => {
        setReviewFrameIdx(prev => {
          if (prev >= liveChain.length - 1) {
            setIsPlaying(false)
            return prev
          }
          return prev + 1
        })
      }, 1000) // 1 FPS playback
    }
    return () => {
      if (reviewTimerRef.current) clearInterval(reviewTimerRef.current)
    }
  }, [hasRecordedSession, isPlaying, liveChain.length])

  const handleReviewPlayPause = () => {
    if (hasRecordedSession) {
      if (reviewFrameIdx >= liveChain.length - 1) {
        setReviewFrameIdx(0)
      }
      setIsPlaying(prev => !prev)
    } else {
      handlePlayPause()
    }
  }

  const handleReviewSeek = (time) => {
    if (hasRecordedSession) {
      // Map time (0..liveElapsed) to frame index
      const idx = Math.round((time / liveElapsed) * (liveChain.length - 1))
      setReviewFrameIdx(Math.max(0, Math.min(idx, liveChain.length - 1)))
    } else {
      handleSeek(time)
    }
  }

  const handleTamper = useCallback((info = null) => {
    setTamperActive(true)
    setTamperInfo(info || { seq: 5 })
    playBreachAlarm()
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    setTimeout(() => {
      setTamperActive(false)
      setTamperInfo(null)
    }, 8000)
  }, [])

  // Global listener for tampering from VerificationPanel
  useEffect(() => {
    window.onSentinelTamperDetected = (info) => {
      handleTamper(info)
    }
    return () => { window.onSentinelTamperDetected = null }
  }, [handleTamper])

  const isLive = mode === 'live'

  return (
    <div className={tamperActive ? 'screen-shake' : ''} style={{
      display: 'grid',
      gridTemplateColumns: '1fr 360px',
      gridTemplateRows: '1fr auto',
      gap: '12px',
      height: 'calc(100vh - 84px)',
      padding: '16px',
      position: 'relative',
      zIndex: 1,
    }}>
      {tamperActive && <TamperSimulator tamperInfo={tamperInfo} />}

      {/* Left Column */}
      <div style={{
        gridColumn: '1',
        gridRow: '1 / 3',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minHeight: 0,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          <div>
            <h2 style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '2px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Synapse GTB // Sentinel</h2>
            <h1 style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px', marginTop: '2px' }}>Surgical Flight Recorder</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Status Badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: isLive ? 'rgba(239, 68, 68, 0.08)' : tamperActive ? 'var(--color-critical-bg)' : 'var(--color-stable-bg)',
              padding: '4px 12px', borderRadius: 'var(--radius-full)',
              border: `1px solid ${isLive ? 'rgba(239, 68, 68, 0.3)' : tamperActive ? 'var(--color-critical)' : 'var(--color-stable)'}33`,
              transition: 'var(--transition-smooth)',
            }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: isLive ? '#ef4444' : tamperActive ? 'var(--color-critical)' : 'var(--color-stable)',
                animation: 'pulse-dot 2s infinite',
              }} />
              <span style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px',
                color: isLive ? '#ef4444' : tamperActive ? 'var(--color-critical)' : 'var(--color-stable)',
              }}>
                {isLive ? 'RECORDING LIVE' : tamperActive ? 'BREACH DETECTED' : mode === 'demo' ? 'DEMO MODE' : mode === 'review' ? 'REVIEW MODE' : 'STANDBY'}
              </span>
            </div>

            {/* Operation Controls */}
            {mode === 'idle' || mode === 'review' || mode === 'demo' ? (
              <>
                {/* Demo Button */}
                <button
                  onClick={() => setMode(mode === 'demo' ? 'idle' : 'demo')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: mode === 'demo' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)',
                    border: `1px solid ${mode === 'demo' ? 'rgba(139, 92, 246, 0.5)' : 'rgba(139, 92, 246, 0.25)'}`,
                    color: '#8b5cf6',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    transition: 'var(--transition-smooth)',
                  }}
                >
                  ▶ {mode === 'demo' ? 'EXIT DEMO' : 'DEMO MODE'}
                </button>

                {/* Start Button */}
                <button
                  onClick={() => setShowStartModal(true)}
                  disabled={starting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: starting ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    opacity: starting ? 0.6 : 1,
                    transition: 'var(--transition-smooth)',
                    boxShadow: '0 2px 12px rgba(16, 185, 129, 0.3)',
                  }}
                >
                  <Radio size={14} />
                  {starting ? 'STARTING...' : 'START OPERATION'}
                </button>
              </>
            ) : (
              <button
                onClick={handleStop}
                disabled={stopping}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: stopping ? 'wait' : 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '1px',
                  opacity: stopping ? 0.6 : 1,
                  transition: 'var(--transition-smooth)',
                }}
              >
                <Square size={12} fill="#ef4444" />
                {stopping ? 'STOPPING...' : 'STOP OPERATION'}
              </button>
            )}

            {/* Tamper sim button (review mode only) */}
            {(mode === 'review' || mode === 'demo') && (
              <button onClick={handleTamper} style={{
                background: 'rgba(255, 45, 85, 0.1)',
                border: '1px solid rgba(255, 45, 85, 0.3)',
                color: 'var(--color-critical)',
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '1px',
                transition: 'var(--transition-smooth)',
              }}>⚠ SIMULATE TAMPER</button>
            )}
          </div>
        </div>

        {/* Hash Metrics */}
        <HashMetrics
          liveMode={isLive}
          idleMode={mode === 'idle'}
          liveSeq={liveSeq}
          liveElapsed={liveElapsed}
          liveLatestHash={liveLatestHash}
          liveBatchCount={liveBatchCount}
        />

        {/* Video / Live Feed */}
        <VideoPlayer
          ref={videoRef}
          isPlaying={isPlaying}
          currentTime={hasRecordedSession ? (reviewChainEntry?.timestamp || 0) : currentTime}
          duration={hasRecordedSession ? liveElapsed : duration}
          onPlayPause={handleReviewPlayPause}
          onLoadedMetadata={(d) => setDuration(d)}
          currentFrame={isLive ? liveFrame : (hasRecordedSession ? reviewFrame : currentFrame)}
          onSeek={handleReviewSeek}
          liveMode={isLive}
          demoMode={mode === 'demo'}
          idleMode={mode === 'idle'}
          validating={validating}
          cameraMode={cameraMode}
          totalFrames={hasRecordedSession ? liveChain.length : 0}
          currentFrameIdx={hasRecordedSession ? reviewFrameIdx : 0}
          reviewVitals={hasRecordedSession ? reviewChainEntry?.vitals : null}
        />

        {/* Vitals */}
        <VitalsSync 
          frame={isLive ? liveFrame : (hasRecordedSession ? reviewFrame : (mode === 'idle' ? baselineVitals : currentFrame))} 
          liveMode={isLive} 
          idleMode={mode === 'idle'} 
        />

        {/* Timeline (demo mode only — uses demo video duration) */}
        {mode === 'demo' && (
          <MagneticTimeline
            telemetry={telemetry}
            currentTime={currentTime}
            duration={duration || (telemetry.length > 0 ? telemetry[telemetry.length - 1].timestamp : 60)}
            onSeek={handleSeek}
            anomalies={anomalies}
            auditTrail={audit}
            tamperActive={tamperActive}
          />
        )}

        {/* Live / Summary elapsed bar */}
        {(isLive || mode === 'review') && liveElapsed > 0 && (
          <div className="glass" style={{
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            borderTop: mode === 'review' ? '2px solid var(--accent-cyan)' : 'none'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={14} style={{ color: isLive ? '#10b981' : 'var(--accent-cyan)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>{isLive ? 'Live Elapsed:' : 'Total Recorded:'}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {Math.floor(liveElapsed / 60).toString().padStart(2, '0')}:{Math.floor(liveElapsed % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
              <span style={{ color: 'var(--text-dim)' }}>
                FRAMES: <span style={{ color: 'var(--text-primary)' }}>{liveSeq}</span>
              </span>
              <span style={{ color: 'var(--text-dim)' }}>
                BATCHES: <span style={{ color: 'var(--text-primary)' }}>{liveBatchCount}</span>
              </span>
              <span style={{ color: 'var(--text-dim)' }}>
                CAM: <span style={{ color: '#10b981' }}>{cameraMode.toUpperCase()}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar */}
      <div style={{
        gridColumn: '2',
        gridRow: '1 / 3',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minHeight: 0,
        overflowY: 'auto',
      }}>
        <HashMatrix
          auditTrail={isLive ? liveChain : audit}
          currentIdx={isLive ? liveSeq : currentAuditIdx}
          tamperActive={tamperActive}
          finalHash={isLive
            ? liveLatestHash
            : (audit.length > 0 ? audit[audit.length - 1].data_hash : null)}
          liveMode={isLive}
        />

        <VerificationPanel activeSessionId={liveSessionId} />

        <MerkleTreeViz auditTrail={isLive ? liveChain : audit} batches={[]} />

        {!isLive && (
          <AnomalyLog
            anomalies={anomalies}
            onJump={handleJumpToAnomaly}
          />
        )}
      </div>

      {/* ── Start Operation Modal ── */}
      <AnimatePresence>
        {showStartModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 400,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowStartModal(false) }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
              className="glass"
              style={{ width: '100%', maxWidth: '400px', padding: '24px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Initialize Sentinel Black Box</h2>
                <button onClick={() => setShowStartModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><X size={18} /></button>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Please select the patient undergoing the operation. Upon completion, a deterministic SHA-256 cryptographic hash securely tying the data points to the patient's identity will be created.
              </p>

              <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>PATIENT</label>
              <select 
                value={selectedPatientId} 
                onChange={e => {
                  setSelectedPatientId(e.target.value)
                  setBaselineVitals({
                    heart_rate: 68 + Math.floor(Math.random() * 15),
                    spo2: 98 + Math.floor(Math.random() * 2),
                    bp_sys: 115 + Math.floor(Math.random() * 20),
                    motion_score: 0.1
                  })
                }} 
                style={{ 
                  width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--input-border)', background: 'var(--input-bg)',
                  color: 'var(--text-primary)', fontSize: '13px', fontFamily: 'var(--font-display)',
                  outline: 'none', cursor: 'pointer', marginBottom: '24px'
                }}
              >
                {patients.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
              </select>

              <button 
                onClick={confirmStartOperation}
                disabled={starting}
                style={{
                  width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)',
                  background: 'linear-gradient(135deg, var(--color-critical), #b91c1c)',
                  border: 'none', color: '#fff', fontSize: '13px', fontWeight: 700,
                  fontFamily: 'var(--font-display)', cursor: starting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
                <Radio size={14} /> INITIALIZE FLIGHT RECORDER
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
