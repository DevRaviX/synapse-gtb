import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { Heart, Wind, Droplets, Activity, Thermometer } from 'lucide-react'

const VITAL_CONFIG = [
  { key: 'heart_rate', label: 'Heart Rate', unit: 'BPM', icon: Heart, color: '#ff2d55', critical: v => v > 110 || v < 50 },
  { key: 'spo2', label: 'SpO2', unit: '%', icon: Droplets, color: '#007aff', critical: v => v < 92 },
  { key: 'map', label: 'MAP', unit: 'mmHg', icon: Activity, color: '#bf5af2', critical: v => v < 60 },
  { key: 'lactate', label: 'Lactate', unit: 'mmol/L', icon: Thermometer, color: '#fbbf24', critical: v => v > 2.0 },
  { key: 'respiratory_rate', label: 'Resp. Rate', unit: '/min', icon: Wind, color: '#34d399', critical: v => v > 30 },
]

export default function VitalsTicker({ vitals, history, status }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: '12px',
    }}>
      {VITAL_CONFIG.map(cfg => {
        const value = vitals[cfg.key]
        const isCritical = cfg.critical(value)
        const Icon = cfg.icon
        const sparkData = history.map(h => ({ v: h[cfg.key] }))

        return (
          <div
            key={cfg.key}
            className="glass"
            style={{
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden',
              borderColor: isCritical ? `${cfg.color}44` : 'var(--glass-border)',
              transition: 'var(--transition-smooth)',
            }}
          >
            {/* Glow effect when critical */}
            {isCritical && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: `radial-gradient(ellipse at center, ${cfg.color}15, transparent 70%)`,
                pointerEvents: 'none',
              }} />
            )}

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon size={12} color={isCritical ? cfg.color : 'var(--text-dim)'} />
                <span style={{
                  fontSize: '10px',
                  color: 'var(--text-dim)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-mono)',
                }}>{cfg.label}</span>
              </div>
              {isCritical && (
                <div style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: cfg.color,
                  animation: 'pulse-dot 1s infinite',
                }} />
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '4px' }}>
              <span
                className={`${cfg.key === 'heart_rate' ? 'animate-heartbeat' : ''} counter-update`}
                style={{
                  fontSize: '28px',
                  fontWeight: 800,
                  color: isCritical ? cfg.color : 'var(--text-primary)',
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '-1px',
                  lineHeight: '28px',
                  animationDuration: cfg.key === 'heart_rate' ? `${60 / value}s` : undefined
                }}>
                {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--'}
              </span>
              <span style={{
                fontSize: '11px',
                color: 'var(--text-dim)',
              }}>{cfg.unit}</span>
            </div>

            {/* Mini sparkline */}
            <div style={{ height: '28px', marginTop: '8px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData}>
                  <defs>
                    <linearGradient id={`grad-${cfg.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={isCritical ? cfg.color : `${cfg.color}88`} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={isCritical ? cfg.color : `${cfg.color}88`} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={isCritical ? cfg.color : `${cfg.color}88`}
                    fillOpacity={1}
                    fill={`url(#grad-${cfg.key})`}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
