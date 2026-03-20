import { forwardRef, useState, useRef, useEffect } from 'react'
import { RotateCcw, SkipBack, Play, Pause, SkipForward, Gauge, Heart, Droplets, Activity as ActivityIcon } from 'lucide-react'

function formatTime(seconds) {
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

const SPEEDS = [0.5, 1, 1.5, 2]
import { API_BASE } from '../../utils/config'

const btnBase = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px',
  borderRadius: '6px',
  transition: 'all 0.15s ease',
}

const VideoPlayer = forwardRef(function VideoPlayer({
  isPlaying, currentTime, duration, onPlayPause, onLoadedMetadata, currentFrame,
  onSeek,
  liveMode = false,
  demoMode = false,
  idleMode = false,
  validating = false,
  cameraMode = 'webcam',
  totalFrames = 0,
  currentFrameIdx = 0,
  reviewVitals = null,
}, ref) {
  const [speed, setSpeed] = useState(1)
  const cctvRef = useRef()
  const [streamError, setStreamError] = useState(false)
  const [useFramePlayback, setUseFramePlayback] = useState(false)
  const [lastSessionId, setLastSessionId] = useState(null)

  // Determine if we should use frame-by-frame playback
  useEffect(() => {
    if (!liveMode && !demoMode && currentFrame?.session_id) {
       setUseFramePlayback(true)
       setLastSessionId(currentFrame.session_id)
    } else if (liveMode || demoMode) {
       setUseFramePlayback(false)
    }
  }, [liveMode, demoMode, currentFrame])

  // --- MASTER CLOCK SYNC (demo mode only) ---
  useEffect(() => {
    if (!demoMode || !cctvRef.current) return
    if (isPlaying) {
      cctvRef.current.play().catch(e => console.error("Auto-play prevented", e))
    } else {
      cctvRef.current.pause()
    }
  }, [isPlaying, demoMode])

  useEffect(() => {
    if (!demoMode || !cctvRef.current) return
    if (!isPlaying || Math.abs(cctvRef.current.currentTime - currentTime) > 0.5) {
      cctvRef.current.currentTime = currentTime
    }
  }, [currentTime, isPlaying, demoMode])

  // AR overlays
  const showHrOverlay = currentFrame && currentFrame.tags?.some(t => t.type === 'HR_SPIKE')
  const showSpo2Overlay = currentFrame && currentFrame.tags?.some(t => t.type === 'SPO2_DROP')

  const handleReplay = () => {
    if (ref?.current) {
      ref.current.currentTime = 0
      ref.current.play()
      if (onSeek) onSeek(0)
    }
  }

  const handleSkipBack = () => {
    if (ref?.current) {
      const t = Math.max(0, ref.current.currentTime - 10)
      ref.current.currentTime = t
      if (onSeek) onSeek(t)
    }
  }

  const handleSkipForward = () => {
    if (ref?.current) {
      const t = Math.min(ref.current.duration || duration, ref.current.currentTime + 10)
      ref.current.currentTime = t
      if (onSeek) onSeek(t)
    }
  }

  const handleCycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed)
    const next = SPEEDS[(idx + 1) % SPEEDS.length]
    setSpeed(next)
    if (ref?.current) ref.current.playbackRate = next
  }

  // ── Vitals Detail Panel (for review mode beside frame) ──
  const VitalsDetailPanel = ({ vitals }) => {
    if (!vitals) return null
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        fontFamily: 'var(--font-mono)',
        justifyContent: 'center',
        height: '100%',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '2px',
          color: 'var(--accent-cyan)', borderBottom: '1px solid var(--glass-border)',
          paddingBottom: '8px', marginBottom: '4px',
        }}>
          PATIENT VITALS @ FRAME {currentFrameIdx + 1}
        </div>

        {/* Heart Rate */}
        <div style={{
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.15)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Heart size={14} style={{ color: '#ef4444' }} />
            <span style={{ fontSize: '9px', letterSpacing: '1.5px', color: 'var(--text-dim)' }}>HEART RATE</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#ef4444' }}>
            {vitals.hr?.toFixed(0) || '--'}
            <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '4px' }}>BPM</span>
          </div>
        </div>

        {/* SpO2 */}
        <div style={{
          background: 'rgba(59, 130, 246, 0.06)',
          border: '1px solid rgba(59, 130, 246, 0.15)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Droplets size={14} style={{ color: '#3b82f6' }} />
            <span style={{ fontSize: '9px', letterSpacing: '1.5px', color: 'var(--text-dim)' }}>SpO2</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#3b82f6' }}>
            {vitals.spo2?.toFixed(0) || '--'}
            <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '4px' }}>%</span>
          </div>
        </div>

        {/* Blood Pressure */}
        <div style={{
          background: 'rgba(16, 185, 129, 0.06)',
          border: '1px solid rgba(16, 185, 129, 0.15)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <ActivityIcon size={14} style={{ color: '#10b981' }} />
            <span style={{ fontSize: '9px', letterSpacing: '1.5px', color: 'var(--text-dim)' }}>BLOOD PRESSURE</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#10b981' }}>
            {vitals.bp_sys?.toFixed(0) || '--'}/{vitals.bp_dia?.toFixed(0) || '--'}
            <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '4px' }}>mmHg</span>
          </div>
        </div>

        {/* Timestamp */}
        <div style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          textAlign: 'center',
        }}>
          <span style={{ fontSize: '9px', letterSpacing: '1.5px', color: 'var(--text-dim)' }}>ELAPSED</span>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
            {formatTime(currentFrame?.timestamp || 0)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '12px' }}>
      
      {/* UNIFIED VIDEO CONTAINER */}
      <div className="glass" style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        padding: '4px',
      }}>
        
        {/* ════════════  DEMO MODE: Dual Surgical Videos  ════════════ */}
        {demoMode && (
          <>
            {/* CAM 01 - Laparoscopic */}
            <div style={{ flex: 1, position: 'relative', background: 'var(--bg-abyss)', borderRight: '1px solid var(--glass-border)' }}>
            <video
                ref={ref}
                preload={demoMode ? "auto" : "none"}
                onLoadedMetadata={(e) => onLoadedMetadata(e.target.duration)}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                muted={false}
              >
                <source src="/video/videoplayback - Trim.mp4" type="video/mp4" />
              </video>
              <div style={{
                position: 'absolute', top: 12, left: 16, zIndex: 11,
                background: 'var(--nav-bg)', padding: '4px 10px', borderRadius: 4, backdropFilter: 'blur(4px)',
                fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6,
                border: '1px solid var(--glass-border)'
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-critical)', animation: 'pulse-dot 2s infinite' }}/>
                CAM 01 // LAPAROSCOPIC
              </div>

              {/* AR Overlays */}
              {showHrOverlay && (
                <div style={{
                  position: 'absolute', top: '15%', right: '10%', padding: '6px 12px',
                  background: 'color-mix(in srgb, var(--color-critical), transparent 85%)', border: '1px solid color-mix(in srgb, var(--color-critical), transparent 40%)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--color-critical)', fontFamily: 'var(--font-mono)',
                  fontSize: '11px', fontWeight: 700, animation: 'pulse-critical 1.5s infinite', backdropFilter: 'blur(4px)',
                }}>
                  ⚡ HR SPIKE: {currentFrame?.heart_rate?.toFixed(0)} BPM
                </div>
              )}
              {showSpo2Overlay && (
                <div style={{
                  position: 'absolute', top: '28%', right: '10%', padding: '6px 12px',
                  background: 'color-mix(in srgb, var(--accent-blue), transparent 85%)', border: '1px solid color-mix(in srgb, var(--accent-blue), transparent 40%)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)',
                  fontSize: '11px', fontWeight: 700, backdropFilter: 'blur(4px)',
                }}>
                  🫁 SpO2 DROP: {currentFrame?.spo2?.toFixed(1)}%
                </div>
              )}
            </div>

            {/* CAM 02 - Wide OR */}
            <div style={{ flex: 1, position: 'relative', background: 'var(--bg-abyss)' }}>
              <video
                ref={cctvRef}
                muted
                style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'grayscale(0.3) contrast(1.1)' }}
              >
                <source src="/video/real video - Trim.mp4" type="video/mp4" />
              </video>
              <div style={{
                position: 'absolute', top: 12, left: 16, zIndex: 11,
                background: 'var(--nav-bg)', padding: '4px 10px', borderRadius: 4, backdropFilter: 'blur(4px)',
                fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6,
                border: '1px solid var(--glass-border)'
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-stable)', animation: 'pulse-dot 2s infinite' }}/>
                CAM 02 // WIDE OR
              </div>
            </div>
          </>
        )}

        {/* ════════════  STANDBY / IDLE MODE  ════════════ */}
        {idleMode && !validating && (
          <div style={{
            flex: 1, position: 'relative', background: 'radial-gradient(circle at center, #0f172a, #020617)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '24px', border: '1px solid var(--glass-border)', borderRadius: '4px',
          }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse-dot 4s infinite ease-in-out'
            }}>
              <RotateCcw size={32} color="var(--text-dim)" style={{ opacity: 0.3 }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-cyan)', letterSpacing: '2px', fontWeight: 800, marginBottom: '8px' }}>
                SENTINEL SECURE CORE // STANDBY
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-secondary)' }}>Awaiting Flight Recorder Initialization</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', maxWidth: '280px', margin: '12px auto 0' }}>
                Select a patient and click "START OPERATION" to begin cryptographic stream recording.
              </p>
            </div>
          </div>
        )}

        {/* ════════════  VALIDATION MODE  ════════════ */}
        {validating && (
          <div style={{
            flex: 1, position: 'relative', background: 'var(--bg-abyss)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '32px'
          }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '120px', height: '120px', borderRadius: '50%',
                border: '2px solid rgba(45, 212, 191, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <div style={{
                  width: '100px', height: '100px', borderRadius: '50%',
                  border: '3px solid transparent', borderTopColor: 'var(--color-brand-accent)',
                  animation: 'spin 0.8s linear infinite'
                }} />
              </div>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIcon size={32} color="var(--color-brand-accent)" style={{ animation: 'bounce 1s infinite' }} />
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-brand-accent)', fontWeight: 800, letterSpacing: '4px' }}>
                VALIDATING STREAM INTEGRITY...
              </span>
              <div style={{ 
                width: '300px', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', 
                marginTop: '20px', overflow: 'hidden', position: 'relative'
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, bottom: 0,
                  background: 'var(--color-brand-accent)',
                  animation: 'shimmer-loading 2s infinite ease-out'
                }} />
              </div>
              <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                ESTABLISHING DETERMINISTIC HASH CHAIN // SHA-256
              </div>
            </div>
          </div>
        )}

        {/* ════════════  LIVE MODE: Single OAK-D Feed  ════════════ */}
        {liveMode && (
          <div style={{ flex: 1, position: 'relative', background: 'var(--bg-abyss)' }}>
            <img
              src={`${API_BASE}/api/stream?t=${Date.now()}`}
              alt="Live Camera Feed"
              onError={() => setStreamError(true)}
              onLoad={() => setStreamError(false)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#000',
              }}
            />
            {streamError && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.85)', color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)', fontSize: '13px', gap: '8px',
              }}>
                <span style={{ fontSize: '32px' }}>📷</span>
                <span>Camera stream unavailable</span>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Check backend is running on :8000</span>
              </div>
            )}

            {/* Live Tag */}
            <div style={{
              position: 'absolute', top: 12, left: 16, zIndex: 11,
              background: 'var(--nav-bg)', padding: '4px 10px', borderRadius: 4, backdropFilter: 'blur(4px)',
              fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6,
              border: '1px solid var(--glass-border)'
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', animation: 'pulse-dot 2s infinite' }}/>
              LIVE // {cameraMode.toUpperCase()}
            </div>

            {/* REC indicator */}
            <div style={{
              position: 'absolute', top: 12, right: 16, zIndex: 11,
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(239, 68, 68, 0.15)', padding: '4px 12px', borderRadius: 4,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700,
              color: '#ef4444', animation: 'pulse-critical 1.5s infinite',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse-dot 1s infinite' }} />
              ● REC
            </div>
          </div>
        )}

        {/* ════════════  REVIEW MODE: Recorded Frame + Vitals  ════════════ */}
        {!liveMode && !demoMode && !idleMode && !validating && (
          <>
            {/* Frame display */}
            <div style={{ flex: useFramePlayback ? 2 : 1, position: 'relative', background: 'var(--bg-abyss)', borderRight: useFramePlayback ? '1px solid var(--glass-border)' : 'none' }}>
              {useFramePlayback ? (
                <img
                  key={`frame-${currentFrame?.frame_idx}`}
                  src={currentFrame ? `${API_BASE}/api/frame/${lastSessionId}/${currentFrame.frame_idx}?t=${currentFrame.frame_idx}` : ''}
                  alt={`Recorded Frame ${currentFrame?.frame_idx || 0}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: '#000',
                  }}
                />
              ) : (
                <video
                  ref={ref}
                  preload="auto"
                  onLoadedMetadata={(e) => onLoadedMetadata(e.target.duration)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  muted={false}
                >
                  <source src="/video/videoplayback - Trim.mp4" type="video/mp4" />
                </video>
              )}

              {/* Tag */}
              <div style={{
                position: 'absolute', top: 12, left: 16, zIndex: 11,
                background: 'var(--nav-bg)', padding: '4px 10px', borderRadius: 4, backdropFilter: 'blur(4px)',
                fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6,
                border: '1px solid var(--glass-border)'
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: isPlaying ? 'var(--color-critical)' : 'var(--text-dim)', animation: isPlaying ? 'pulse-dot 1s infinite' : 'none' }}/>
                {useFramePlayback ? `RECORDED // ${cameraMode.toUpperCase()}` : 'CAM 01 // LAPAROSCOPIC'}
              </div>
            </div>

            {/* Vitals detail panel (only in frame playback review) */}
            {useFramePlayback && (
              <div style={{
                flex: 1,
                background: 'var(--bg-abyss)',
                borderLeft: '1px solid var(--glass-border)',
                overflow: 'auto',
              }}>
                <VitalsDetailPanel vitals={reviewVitals} />
              </div>
        )}
      </>
    )}

    {!liveMode && !idleMode && !validating && (
          <div style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(16px)',
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--glass-border)',
          }}>
            <button onClick={handleReplay} title="Replay" style={btnBase}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--sidebar-item-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
            ><RotateCcw size={15} /></button>
            <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)' }} />
            <button onClick={handleSkipBack} title="Back 10s" style={{ ...btnBase, position: 'relative' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--sidebar-item-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
            ><SkipBack size={15} /><span style={{ position: 'absolute', bottom: '-1px', right: '2px', fontSize: '7px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>10</span></button>
            <button onClick={onPlayPause} title={isPlaying ? 'Pause' : 'Play'} style={{
              background: 'var(--text-primary)', color: 'var(--bg-surface)', border: 'none',
              width: '34px', height: '34px', borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              transition: 'transform 0.15s ease, box-shadow 0.15s', boxShadow: 'var(--glass-shadow)',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {isPlaying ? <Pause size={16} fill="#000" /> : <Play size={16} fill="#000" style={{ marginLeft: '2px' }} />}
            </button>
            <button onClick={handleSkipForward} title="Forward 10s" style={{ ...btnBase, position: 'relative' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--sidebar-item-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
            ><SkipForward size={15} /><span style={{ position: 'absolute', bottom: '-1px', right: '2px', fontSize: '7px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>10</span></button>
            <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)' }} />
            <button onClick={handleCycleSpeed} title={`Speed: ${speed}x`} style={{
              ...btnBase, fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, gap: '3px', padding: '4px 8px',
              color: speed !== 1 ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--sidebar-item-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            ><Gauge size={12} />{speed}x</button>
            <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)', letterSpacing: '0.5px', minWidth: '85px', textAlign: 'center' }}>
              {useFramePlayback
                ? `Frame ${currentFrameIdx + 1} / ${totalFrames}`
                : `${formatTime(currentTime)} / ${formatTime(duration)}`
              }
            </span>
          </div>
        )}

        {/* Top-left badge (only for live mode) */}
        {liveMode && (
          <div style={{
            position: 'absolute', top: '12px', left: '12px',
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'var(--nav-bg)', backdropFilter: 'blur(8px)',
            padding: '4px 10px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--glass-border)',
          }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#ef4444',
              animation: 'pulse-dot 1s infinite',
            }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-secondary)', letterSpacing: '1.5px' }}>
              LIVE
            </span>
          </div>
        )}
      </div>
    </div>
  )
})

export default VideoPlayer
