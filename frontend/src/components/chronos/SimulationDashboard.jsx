import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  ArrowLeft, Activity, Heart, Thermometer, Droplets, Wind, Zap, 
  Brain, FlaskConical, Pill, Clock, TrendingUp, ChevronDown, 
  ChevronRight, AlertTriangle, Shield, BarChart3, Layers,
  Pause, Play, SkipForward, Info
} from 'lucide-react'
import { LineChart, Line, AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip, ReferenceLine } from 'recharts'
import {
  simulationEngine, STATIC_FEATURES, FEATURE_LABELS, FEATURE_UNITS,
  FEATURE_CATEGORIES, ALL_FEATURE_NAMES
} from '../../data/simulationEngine'
import { supabase } from '../../supabaseClient'
import { FEATURE_INFO } from '../../data/featureInfo'

// Category icons
const CATEGORY_ICONS = {
  'Vitals': Heart,
  'Oxygenation': Wind,
  'Organ Support': Shield,
  'Laboratory': FlaskConical,
  'Renal': Droplets,
  'SOFA Scores': Layers,
  'Risk Indices': AlertTriangle,
  'Temporal': Clock,
  'Severity Scores': Brain,
  '12h Rolling Window': BarChart3,
}

// Category accent colors
const CATEGORY_COLORS = {
  'Vitals': 'var(--accent-red)',
  'Oxygenation': 'var(--accent-blue)',
  'Organ Support': 'var(--accent-purple)',
  'Laboratory': 'var(--accent-amber)',
  'Renal': 'var(--accent-cyan)',
  'SOFA Scores': 'var(--accent-green)',
  'Risk Indices': 'var(--color-critical)',
  'Temporal': 'var(--text-secondary)',
  'Severity Scores': 'var(--accent-purple)',
  '12h Rolling Window': 'var(--accent-blue)',
}

// Critical thresholds for feature values
const CRITICAL_THRESHOLDS = {
  hr: { low: 50, high: 120 },
  map_mean: { low: 60, high: null },
  sbp: { low: 90, high: 180 },
  spo2: { low: 92, high: null },
  rr: { low: null, high: 30 },
  temp_c: { low: 35.5, high: 38.5 },
  lactate: { low: null, high: 2.0 },
  creatinine: { low: null, high: 2.0 },
  platelets: { low: 100, high: null },
  gcs_total: { low: 12, high: null },
  sofa_approx: { low: null, high: 6 },
  shock_index: { low: null, high: 0.9 },
  pf_ratio: { low: 200, high: null },
  potassium: { low: 3.0, high: 5.5 },
  glucose: { low: 70, high: 200 },
}

function isCritical(key, value) {
  const t = CRITICAL_THRESHOLDS[key]
  if (!t || value == null) return false
  if (t.low != null && value < t.low) return true
  if (t.high != null && value > t.high) return true
  return false
}

export default function SimulationDashboard({ patient, onBack }) {
  const [snapshot, setSnapshot] = useState(null)
  const [history, setHistory] = useState([])
  const [expandedCats, setExpandedCats] = useState(new Set(['Vitals', 'SOFA Scores', 'Risk Indices']))
  const [isPaused, setIsPaused] = useState(false)
  const [selectedFeature, setSelectedFeature] = useState('hr')
  const [hoveredFeature, setHoveredFeature] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [simSpeed, setSimSpeed] = useState(1) // 1 = normal (1 min = 1 hour), 2 = 2x, etc.
  const isPausedRef = useRef(false)

  // Initialize simulation on mount
  useEffect(() => {
    simulationEngine.initPatient(patient.id, patient.status)
    // Run a few initial ticks to seed history
    for (let i = 0; i < 4; i++) {
      simulationEngine.tick(patient.id, patient.status)
    }
    setHistory(simulationEngine.getHistory(patient.id))
    setSnapshot(simulationEngine.getCurrent(patient.id))
  }, [patient.id])

  // Simulation interval: 1 tick per minute (= 1 ICU hour)
  useEffect(() => {
    const intervalMs = (60 * 1000) / simSpeed // 60s for 1x, 30s for 2x, etc.
    const interval = setInterval(() => {
      if (isPausedRef.current) return
      const snap = simulationEngine.tick(patient.id, patient.status)
      setSnapshot(snap)
      setHistory(simulationEngine.getHistory(patient.id))
    }, intervalMs)
    return () => clearInterval(interval)
  }, [patient.id, patient.status, simSpeed])

  // Sync pause ref
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused])

  // Trigger notifications on condition degradation
  const prevSofa = useRef(-1)
  useEffect(() => {
    if (!snapshot || !patient || isPaused) return
    const currentSofa = snapshot.sofa_approx
    
    if (prevSofa.current !== -1 && currentSofa > prevSofa.current) {
      if (currentSofa >= 5 && prevSofa.current < 5) {
        supabase.from('notifications').insert({
          patient_id: patient.id,
          risk_score: Math.floor(Math.min(95, 50 + currentSofa * 5)),
          type: 'ringing',
          message: `🚨 ALERT: SOFA Score rose to ${currentSofa}. Patient deteriorating rapidly.`,
          is_read: false
        }).then()
      } else if (currentSofa >= 3 && prevSofa.current < 3) {
        supabase.from('notifications').insert({
          patient_id: patient.id,
          risk_score: Math.floor(Math.min(60, 30 + currentSofa * 5)),
          type: 'silent',
          message: `⚠️ WARNING: SOFA Score increased to ${currentSofa}. Monitor closely.`,
          is_read: false
        }).then()
      }
    }
    
    if (snapshot.shock_index >= 0.9 && Math.random() < 0.1) {
      supabase.from('notifications').insert({
        patient_id: patient.id,
        risk_score: 92,
        type: 'ringing',
        message: `🚨 CRITICAL: Shock index elevated (${snapshot.shock_index}). Ensure adequate perfusion.`,
        is_read: false
      }).then()
    }
    
    prevSofa.current = currentSofa
  }, [snapshot?._hour, patient?.id, isPaused])

  const handleSkip = useCallback(() => {
    const snap = simulationEngine.tick(patient.id, patient.status)
    setSnapshot(snap)
    setHistory(simulationEngine.getHistory(patient.id))
  }, [patient.id, patient.status])

  const toggleCategory = useCallback((cat) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const statics = STATIC_FEATURES[patient.id]
  if (!snapshot) return null

  const dynamicFeatureCount = Object.keys(FEATURE_CATEGORIES)
    .filter(cat => !['Severity Scores', 'Temporal'].includes(cat))
    .reduce((sum, cat) => sum + FEATURE_CATEGORIES[cat].length, 0)

  const totalFeatures = ALL_FEATURE_NAMES.length

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'var(--bg-abyss)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── HEADER ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px)',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none', border: '1px solid var(--color-border-subtle)',
              color: 'var(--text-secondary)', padding: '6px 14px',
              borderRadius: 'var(--radius-full)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: '11px',
              transition: 'var(--transition-smooth)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand-accent)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <ArrowLeft size={14} /> Back to Chronos
          </button>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px' }}>
              TEMPORAL SIMULATION · {totalFeatures} FEATURES
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>
              Bed {patient.bed} — {patient.name}
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '12px', fontSize: '13px' }}>
                {patient.admitReason} · Age {patient.age}
              </span>
            </div>
          </div>
        </div>

        {/* Sim controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Live indicator */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 12px', borderRadius: 'var(--radius-full)',
            background: isPaused ? 'var(--color-observing-bg)' : 'var(--color-stable-bg)',
            border: `1px solid ${isPaused ? 'var(--color-observing)' : 'var(--color-stable)'}33`,
            fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: isPaused ? 'var(--color-observing)' : 'var(--color-stable)',
            letterSpacing: '1.5px',
          }}>
            {!isPaused && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-stable)', animation: 'pulse-dot 1s infinite' }} />}
            {isPaused ? 'PAUSED' : 'SIMULATING'}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
            HOUR {snapshot._hour || 0}
          </div>

          {/* Speed selector */}
          <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)', overflow: 'hidden' }}>
            {[1, 2, 5].map(sp => (
              <button
                key={sp}
                onClick={() => setSimSpeed(sp)}
                style={{
                  padding: '4px 10px', border: 'none', cursor: 'pointer',
                  background: simSpeed === sp ? 'var(--color-brand-accent)' : 'transparent',
                  color: simSpeed === sp ? '#fff' : 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600,
                }}
              >
                {sp}×
              </button>
            ))}
          </div>

          <button onClick={() => setIsPaused(!isPaused)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '32px', height: '32px', borderRadius: 'var(--radius-sm)',
            background: 'var(--glass-bg)', border: '1px solid var(--color-border-subtle)',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}>
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          
          <button onClick={handleSkip} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '32px', height: '32px', borderRadius: 'var(--radius-sm)',
            background: 'var(--glass-bg)', border: '1px solid var(--color-border-subtle)',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}>
            <SkipForward size={14} />
          </button>
        </div>
      </div>

      {/* ── BODY: two-column layout ── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '0',
        overflow: 'hidden',
      }}>
        {/* ── LEFT: Feature Detail Chart + Selected Feature History ── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--color-border-subtle)',
          overflow: 'hidden',
        }}>
          {/* Selected feature chart */}
          <div className="glass" style={{
            margin: '12px 12px 0',
            padding: '16px',
            minHeight: '200px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px' }}>
                    FEATURE TIMELINE
                  </div>
                  {FEATURE_INFO[selectedFeature] && (
                    <div className="group relative">
                      <Info size={12} color="var(--text-dim)" className="cursor-help" />
                      <div className="absolute left-0 top-full mt-2 w-72 p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--glass-bg-solid)] shadow-2xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none">
                        <div className="text-[10px] font-mono text-[var(--accent-blue)] mb-1 uppercase tracking-wider">Clinical Context</div>
                        <div className="text-xs text-[var(--text-primary)] mb-2 leading-relaxed">{FEATURE_INFO[selectedFeature].clinical}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] mb-2 leading-relaxed border-l-2 border-[var(--color-border-subtle)] pl-2">{FEATURE_INFO[selectedFeature].why}</div>
                        <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-[var(--color-border-subtle)]">
                          <div>
                            <div className="text-[8px] font-mono text-[var(--text-dim)] uppercase">Safe Range</div>
                            <div className="text-[10px] font-medium text-[var(--color-stable)]">{FEATURE_INFO[selectedFeature].safeRange}</div>
                          </div>
                          <div>
                            <div className="text-[8px] font-mono text-[var(--text-dim)] uppercase">Critical</div>
                            <div className="text-[10px] font-medium text-[var(--color-critical)]">{FEATURE_INFO[selectedFeature].critical}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '2px' }}>
                  {FEATURE_LABELS[selectedFeature] || selectedFeature}
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: '8px', fontWeight: 400 }}>
                    {FEATURE_UNITS[selectedFeature]}
                  </span>
                </div>
              </div>
              <div style={{
                fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-display)',
                color: isCritical(selectedFeature, snapshot[selectedFeature]) ? 'var(--color-critical)' : 'var(--text-primary)',
                letterSpacing: '-1px',
              }}>
                {snapshot[selectedFeature] != null 
                  ? (typeof snapshot[selectedFeature] === 'number' 
                    ? (Number.isInteger(snapshot[selectedFeature]) ? snapshot[selectedFeature] : snapshot[selectedFeature].toFixed(2))
                    : snapshot[selectedFeature])
                  : '—'}
              </div>
            </div>
            
            <div style={{ height: '140px', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                <AreaChart data={history.map((h, i) => ({ hour: h._hour || i, value: h[selectedFeature] }))}>
                  <defs>
                    <linearGradient id="featureGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-brand-accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-brand-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="hour" 
                    stroke="var(--text-dim)" 
                    fontSize={9} 
                    fontFamily="var(--font-mono)"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="var(--text-dim)" 
                    fontSize={9} 
                    fontFamily="var(--font-mono)"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <RechartsTooltip 
                    contentStyle={{
                      background: 'var(--glass-bg-solid)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--text-primary)',
                    }}
                    labelFormatter={(v) => `Hour ${v}`}
                  />
                  {CRITICAL_THRESHOLDS[selectedFeature]?.high && (
                    <ReferenceLine 
                      y={CRITICAL_THRESHOLDS[selectedFeature].high} 
                      stroke="var(--color-critical)" 
                      strokeDasharray="4 4" 
                      strokeOpacity={0.6}
                    />
                  )}
                  {CRITICAL_THRESHOLDS[selectedFeature]?.low && (
                    <ReferenceLine 
                      y={CRITICAL_THRESHOLDS[selectedFeature].low} 
                      stroke="var(--color-observing)" 
                      strokeDasharray="4 4" 
                      strokeOpacity={0.6}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-brand-accent)"
                    fillOpacity={1}
                    fill="url(#featureGrad)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Feature Category Panels ── */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
            {Object.entries(FEATURE_CATEGORIES).map(([category, features]) => {
              const CatIcon = CATEGORY_ICONS[category] || Activity
              const catColor = CATEGORY_COLORS[category] || 'var(--text-secondary)'
              const isExpanded = expandedCats.has(category)
              const critCount = features.filter(f => isCritical(f, snapshot[f])).length
              const isStatic = category === 'Severity Scores'

              return (
                <div key={category} style={{ marginBottom: '6px' }}>
                  <button
                    onClick={() => toggleCategory(category)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '10px 14px',
                      background: isExpanded ? `${catColor}08` : 'transparent',
                      border: `1px solid ${isExpanded ? `${catColor}22` : 'var(--color-border-subtle)'}`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      transition: 'var(--transition-fast)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CatIcon size={14} color={catColor} />
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>{category}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {features.length} features
                      </span>
                      {isStatic && (
                        <span style={{ 
                          fontSize: '9px', padding: '2px 6px', borderRadius: 'var(--radius-full)',
                          background: 'var(--badge-bg)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                          letterSpacing: '1px',
                        }}>STATIC</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {critCount > 0 && (
                        <span style={{ 
                          fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                          color: 'var(--color-critical)',
                          padding: '2px 8px', borderRadius: 'var(--radius-full)',
                          background: 'var(--color-critical-bg)',
                        }}>
                          {critCount} ALERT
                        </span>
                      )}
                      {isExpanded ? <ChevronDown size={14} color="var(--text-dim)" /> : <ChevronRight size={14} color="var(--text-dim)" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                          gap: '6px',
                          padding: '8px 2px',
                        }}>
                          {features.map(feat => {
                            const val = snapshot[feat]
                            const critical = isCritical(feat, val)
                            const isSelected = selectedFeature === feat

                            return (
                              <button
                                key={feat}
                                onClick={() => setSelectedFeature(feat)}
                                onMouseEnter={(e) => {
                                  setHoveredFeature(feat)
                                  setMousePos({ x: e.clientX, y: e.clientY })
                                }}
                                onMouseMove={(e) => {
                                  if (hoveredFeature === feat) {
                                    setMousePos({ x: e.clientX, y: e.clientY })
                                  }
                                }}
                                onMouseLeave={() => setHoveredFeature(null)}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: 'var(--radius-sm)',
                                  border: `1px solid ${isSelected ? catColor : critical ? 'var(--color-critical)' : 'var(--color-border-subtle)'}`,
                                  background: isSelected ? `${catColor}12` : critical ? 'var(--color-critical-bg)' : 'var(--glass-bg)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  transition: 'var(--transition-fast)',
                                  color: 'var(--text-primary)',
                                  fontFamily: 'var(--font-display)',
                                  position: 'relative',
                                }}
                              >
                                {critical && (
                                  <div style={{
                                    position: 'absolute', left: 0, top: 0, bottom: 0,
                                    width: '3px', background: 'var(--color-critical)',
                                  }} />
                                )}
                                <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px', marginBottom: '4px' }}>
                                  {FEATURE_LABELS[feat] || feat}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                  <span style={{
                                    fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-display)',
                                    color: critical ? 'var(--color-critical)' : 'var(--text-primary)',
                                    letterSpacing: '-0.5px',
                                  }}>
                                    {val != null
                                      ? (typeof val === 'number'
                                        ? (Number.isInteger(val) ? val : val.toFixed(val < 10 && val > -10 && val !== 0 ? 2 : 1))
                                        : val)
                                      : '—'}
                                  </span>
                                  <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>
                                    {FEATURE_UNITS[feat]}
                                  </span>
                                </div>
                                {/* Mini sparkline */}
                                <div style={{ height: '18px', marginTop: '4px', minWidth: 0 }}>
                                  <ResponsiveContainer width="100%" height="100%" minHeight={18}>
                                    <LineChart data={history.slice(-12).map((h, i) => ({ v: h[feat] }))}>
                                      <Line 
                                        type="monotone" 
                                        dataKey="v" 
                                        stroke={critical ? 'var(--color-critical)' : catColor}
                                        strokeWidth={1}
                                        dot={false}
                                        isAnimationActive={false}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>

                              </button>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT: Patient Info + Static Features + Summary ── */}
        <div style={{ overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Patient card */}
          <div className="glass" style={{ padding: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '8px' }}>
              PATIENT PROFILE
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>
                  {patient.name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Bed {patient.bed} · {patient.id} · {patient.admitReason}
                </div>
              </div>
              <StatusBadge status={patient.status} />
            </div>
          </div>

          {/* Static features */}
          <div className="glass" style={{ padding: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '10px' }}>
              STATIC FEATURES (11 CONSTANTS)
            </div>
            {statics && Object.entries(statics).map(([key, val]) => (
              <div key={key} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {FEATURE_LABELS[key] || key.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  {typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(2)) : val}
                </span>
              </div>
            ))}
          </div>

          {/* SOFA Score Hexagon Summary */}
          <div className="glass" style={{ padding: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '10px' }}>
              SOFA SCORE BREAKDOWN
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {['sofa_resp', 'sofa_coag', 'sofa_liver', 'sofa_renal', 'sofa_cardio', 'sofa_cns'].map(key => {
                const val = snapshot[key] || 0
                const maxVal = 4
                const pct = (val / maxVal) * 100
                const color = val >= 3 ? 'var(--color-critical)' : val >= 2 ? 'var(--color-observing)' : 'var(--color-stable)'
                return (
                  <div key={key} style={{ textAlign: 'center', width: '60px' }}>
                    <div style={{
                      width: '44px', height: '44px', borderRadius: '50%',
                      border: `3px solid ${color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto', fontFamily: 'var(--font-mono)', fontSize: '16px',
                      fontWeight: 800, color,
                      background: `${color}15`,
                    }}>
                      {val}
                    </div>
                    <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '4px', letterSpacing: '0.5px' }}>
                      {key.replace('sofa_', '').toUpperCase()}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{
              textAlign: 'center', marginTop: '12px', padding: '8px',
              borderRadius: 'var(--radius-sm)',
              background: snapshot.sofa_approx >= 8 ? 'var(--color-critical-bg)' : 'var(--glass-bg)',
              border: `1px solid ${snapshot.sofa_approx >= 8 ? 'var(--color-critical)' : 'var(--color-border-subtle)'}33`,
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>TOTAL SOFA</span>
              <div style={{
                fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-display)',
                color: snapshot.sofa_approx >= 8 ? 'var(--color-critical)' : snapshot.sofa_approx >= 4 ? 'var(--color-observing)' : 'var(--color-stable)',
                letterSpacing: '-1px',
              }}>
                {snapshot.sofa_approx}
                <span style={{ fontSize: '14px', color: 'var(--text-dim)', fontWeight: 400 }}>/24</span>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="glass" style={{ padding: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '10px' }}>
              REAL-TIME RISK SIGNALS
            </div>
            <QuickStat label="Shock Index" value={snapshot.shock_index} threshold={0.9} above />
            <QuickStat label="P/F Ratio" value={snapshot.pf_ratio} threshold={200} above={false} />
            <QuickStat label="AKI Stage" value={snapshot.aki_stage} threshold={2} above />
            <QuickStat label="ARDS Flag" value={snapshot.ards_flag} threshold={1} above={false} isFlag />
            <QuickStat label="ΔSOFA (6h)" value={snapshot.delta_sofa_6h} threshold={2} above />
            <QuickStat label="ICU Hour" value={snapshot.hours_since_admission} isInfo />
          </div>

          {/* Feature count summary */}
          <div style={{
            padding: '12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--glass-bg)',
            fontSize: '10px', fontFamily: 'var(--font-mono)',
            color: 'var(--text-dim)', textAlign: 'center',
          }}>
            <div>{dynamicFeatureCount} dynamic features updating every {60/simSpeed}s</div>
            <div style={{ marginTop: '4px' }}>
              {Object.keys(STATIC_FEATURES[patient.id] || {}).length} static features hardcoded
            </div>
            <div style={{ marginTop: '4px', color: 'var(--color-brand-accent)' }}>
              {totalFeatures} total model features
            </div>
          </div>
        </div>
      </div>

      {/* GLOBAL FIXED TOOLTIP */}
      <AnimatePresence>
        {hoveredFeature && FEATURE_INFO[hoveredFeature] && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{
              position: 'fixed',
              zIndex: 99999,
              // Offset slightly so cursor doesn't obscure it
              top: mousePos.y + 15,
              left: mousePos.x + 15,
              width: 'max-content',
              maxWidth: '240px',
              padding: '12px',
              background: 'var(--glass-bg-solid)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
              // Keep it within screen bounds
              transform: mousePos.x > window.innerWidth - 260 ? 'translateX(-100%)' : 'none'
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              {FEATURE_INFO[hoveredFeature].label}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: '8px' }}>
              {FEATURE_INFO[hoveredFeature].clinical}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '8px' }}>
              <div>
                <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Safe Range</div>
                <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--color-stable)' }}>{FEATURE_INFO[hoveredFeature].safeRange}</div>
              </div>
              <div>
                <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Critical</div>
                <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--color-critical)' }}>{FEATURE_INFO[hoveredFeature].critical}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatusBadge({ status }) {
  const color = status === 'critical' ? 'var(--color-critical)' 
    : status === 'observing' ? 'var(--color-observing)' 
    : 'var(--color-stable)'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: 'var(--radius-full)',
      background: `${color}12`, border: `1px solid ${color}33`,
      fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700,
      color, letterSpacing: '1.5px', textTransform: 'uppercase',
    }}>
      <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, animation: 'pulse-dot 1.5s infinite' }} />
      {status}
    </div>
  )
}

function QuickStat({ label, value, threshold, above, isFlag, isInfo }) {
  let critical = false
  if (!isInfo && !isFlag && value != null && threshold != null) {
    critical = above ? value >= threshold : value <= threshold
  }
  if (isFlag) {
    critical = value === 1
  }
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid var(--color-border-subtle)',
    }}>
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{
        fontSize: '13px', fontWeight: 700, fontFamily: 'var(--font-mono)',
        color: critical ? 'var(--color-critical)' : isInfo ? 'var(--color-brand-accent)' : 'var(--text-primary)',
      }}>
        {value != null ? (typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(2)) : value) : '—'}
        {isFlag && <span style={{ fontSize: '9px', marginLeft: '4px' }}>{value === 1 ? '⚠️' : '✓'}</span>}
      </span>
    </div>
  )
}
