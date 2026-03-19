import { useState, useCallback, useEffect, useRef } from 'react'
import HumanModel3D from '../components/chronos/HumanModel3D'
import TriageRadar from '../components/chronos/TriageRadar'
import CrashOdometer from '../components/chronos/CrashOdometer'
import ShapExplainer from '../components/chronos/ShapExplainer'
import VitalsTicker from '../components/chronos/VitalsTicker'
import GenerateAccessQR from '../components/chronos/GenerateAccessQR'
import { patients } from '../data/mockChronosData'
import { playCriticalBeep, playNavClick } from '../utils/sounds'

// Realistic vital fluctuation config
const VITAL_SIM = {
  heart_rate:       { variance: 3,    decimals: 0, min: 40,  max: 200 },
  spo2:             { variance: 0.5,  decimals: 1, min: 70,  max: 100 },
  map:              { variance: 2,    decimals: 0, min: 30,  max: 120 },
  lactate:          { variance: 0.15, decimals: 2, min: 0.3, max: 15  },
  respiratory_rate: { variance: 1,    decimals: 0, min: 8,   max: 50  },
}

function simulateVitals(base, status) {
  const volatility = status === 'critical' ? 2.0 : status === 'observing' ? 1.2 : 0.6
  const next = {}
  for (const [key, cfg] of Object.entries(VITAL_SIM)) {
    const current = base[key]
    const delta = (Math.random() - 0.48) * cfg.variance * volatility
    const raw = current + delta
    const clamped = Math.max(cfg.min, Math.min(cfg.max, raw))
    next[key] = Number(clamped.toFixed(cfg.decimals))
  }
  return next
}

export default function ChronosView({ onRiskChange }) {
  const [selectedId, setSelectedId] = useState(patients[0].id)
  
  // Live patients with fluctuating risk scores
  const [livePatients, setLivePatients] = useState(patients)
  const livePatientsRef = useRef(patients)
  
  const [liveVitals, setLiveVitals] = useState(patients[0].currentVitals)
  const [liveHistory, setLiveHistory] = useState(patients[0].vitalHistory)
  const vitalsRef = useRef(patients[0].currentVitals)

  // Risk simulation: fluctuate scores every 3s (mean-reverting to baseline)
  useEffect(() => {
    const interval = setInterval(() => {
      const updated = livePatientsRef.current.map(p => {
        const base = patients.find(bp => bp.id === p.id)
        const jitter = (key) => {
          const current = p.riskScores[key]
          const baseline = base.riskScores[key]
          // Random walk step
          const randomStep = (Math.random() - 0.5) * 0.04
          // Mean reversion (gravity towards baseline)
          const pull = (baseline - current) * 0.1
          const v = current + randomStep + pull
          return Math.max(0.02, Math.min(0.99, Number(v.toFixed(3))))
        }
        const newScores = {
          shock: jitter('shock'),
          sepsis: jitter('sepsis'),
          deterioration: jitter('deterioration'),
          arrest: jitter('arrest'),
        }
        const newAggregate = Math.max(newScores.shock, newScores.sepsis, newScores.deterioration, newScores.arrest)
        return { ...p, riskScores: newScores, aggregateRisk: Number(newAggregate.toFixed(3)) }
      })
      livePatientsRef.current = updated
      setLivePatients(updated)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const selectedPatient = livePatients.find(p => p.id === selectedId) || livePatients[0]

  // Notify parent of risk level changes for ambient particles
  useEffect(() => {
    if (onRiskChange && selectedPatient) {
      onRiskChange(selectedPatient.aggregateRisk)
    }
  }, [selectedPatient?.aggregateRisk, onRiskChange])
  
  // Vitals simulation engine: tick every 1.5s reading the real timeline datastream
  const timeIndexRef = useRef(0)

  // Reset when patient changes
  useEffect(() => {
    setLiveVitals(selectedPatient.currentVitals)
    setLiveHistory(selectedPatient.vitalHistory)
    vitalsRef.current = selectedPatient.currentVitals
    timeIndexRef.current = selectedPatient.vitalHistory.length // Start reading after historical span
  }, [selectedId])

  useEffect(() => {
    const interval = setInterval(() => {
      const timeseries = selectedPatient.realTimeSeries || [];
      if (timeseries.length === 0) return; // Fallback if no data somehow

      // Loop over data array
      if (timeIndexRef.current >= timeseries.length) {
        timeIndexRef.current = 0; 
      }
      
      const nextReal = timeseries[timeIndexRef.current];
      timeIndexRef.current += 1;

      // Extract raw vitals to overlay onto current state
      const next = {
        heart_rate: nextReal.heart_rate || vitalsRef.current.heart_rate,
        spo2: nextReal.spo2 || vitalsRef.current.spo2,
        map: nextReal.map || vitalsRef.current.map,
        lactate: nextReal.lactate || vitalsRef.current.lactate,
        respiratory_rate: nextReal.respiratory_rate || vitalsRef.current.respiratory_rate,
      }

      vitalsRef.current = next
      setLiveVitals(next)
      setLiveHistory(prev => {
        const updated = [...prev, next]
        return updated.length > 30 ? updated.slice(-30) : updated
      })
    }, 1500)
    return () => clearInterval(interval)
  }, [selectedId])

  const handleSelectPatient = useCallback((patient) => {
    playNavClick()
    if (patient.status === 'critical') playCriticalBeep()
    setSelectedId(patient.id)
  }, [])

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 380px',
      gridTemplateRows: '1fr auto',
      gap: '16px',
      height: 'calc(100vh - 56px)',
      padding: '16px',
      position: 'relative',
      zIndex: 1,
    }}>
      {/* Center: 3D Model + Odometer */}
      <div style={{
        gridColumn: '1',
        gridRow: '1',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        minHeight: 0,
      }}>
        {/* Header bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4px',
        }}>
          <div>
            <h2 style={{
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '2px',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
            }}>Project Chronos</h2>
            <h1 style={{
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '-0.5px',
              marginTop: '2px',
            }}>ICU Predictive Command Center</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <GenerateAccessQR patientId={selectedPatient.id} inline={true} />
            <StatusIndicator status={selectedPatient.status} />
            <CrashOdometer value={selectedPatient.aggregateRisk} />
          </div>
        </div>

        {/* 3D Model */}
        <div className="glass" style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <HumanModel3D
            highlightOrgan={selectedPatient.highlightOrgan}
            riskLevel={selectedPatient.aggregateRisk}
          />
          {/* Patient info overlay */}
          <div className="absolute bottom-6 left-6 flex flex-col gap-3 w-80 z-40">
            <div className="bg-slate-900/60 backdrop-blur-xl px-6 py-5 rounded-xl border border-white/10 shadow-2xl relative overflow-hidden flex flex-col items-center text-center">
              {/* Decorative accent line */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/50"></div>
              
              <div className="text-[10px] text-emerald-400 font-mono tracking-[0.2em] mb-1">
                SELECTED PATIENT
              </div>
              <div className="text-xl font-bold text-white tracking-wide">
                Bed {selectedPatient.bed} <span className="text-slate-500 mx-1">—</span> {selectedPatient.name}
              </div>
              <div className="text-xs text-slate-400 mt-1.5 flex items-center justify-center gap-2">
                <span className="truncate">{selectedPatient.admitReason}</span>
                <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                <span className="whitespace-nowrap">Age {selectedPatient.age}</span>
              </div>
            </div>
          </div>
        </div>

        {/* SHAP Explainer */}
        <div className="glass" style={{ padding: '16px', minHeight: '160px' }}>
          <ShapExplainer features={selectedPatient.shapFeatures} patientId={selectedPatient.id} />
        </div>
      </div>

      {/* Right: Triage Radar */}
      <div style={{
        gridColumn: '2',
        gridRow: '1 / 3',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}>
        <TriageRadar
          patients={livePatients}
          selected={selectedPatient}
          onSelect={handleSelectPatient}
        />
      </div>

      {/* Bottom: Vitals Ticker */}
      <div style={{ gridColumn: '1', gridRow: '2' }}>
        <VitalsTicker vitals={liveVitals} history={liveHistory} status={selectedPatient.status} />
      </div>
    </div>
  )
}

function StatusIndicator({ status }) {
  const colors = {
    stable: 'var(--color-stable)',
    observing: 'var(--color-observing)',
    critical: 'var(--color-critical)',
  }
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 12px',
      borderRadius: 'var(--radius-full)',
      background: status === 'critical' ? 'var(--color-critical-bg)' : status === 'observing' ? 'var(--color-observing-bg)' : 'var(--color-stable-bg)',
      border: `1px solid ${colors[status]}33`,
    }}>
      <div style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: colors[status],
        animation: status === 'critical' ? 'pulse-dot 1s infinite' : 'pulse-dot 2s infinite',
      }} />
      <span style={{
        fontSize: '10px',
        fontWeight: 700,
        color: colors[status],
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
      }}>{status}</span>
    </div>
  )
}
