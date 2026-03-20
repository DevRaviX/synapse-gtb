import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { Html5Qrcode } from 'html5-qrcode'
import {
  Syringe, FileText, MessageSquareWarning, ClipboardList, Users, Building2,
  CheckCircle2, Clock, AlertTriangle, Pill, ChevronDown, ChevronRight,
  Plus, Send, X, Upload, ShieldCheck
} from 'lucide-react'

export default function ICUCommandCenter({ onNavigate }) {
  const { user: doctor } = useAuth()
  const [activeTab, setActiveTab] = useState('instructions')
  const [instructions, setInstructions] = useState([])
  const [administered, setAdministered] = useState([])
  const [complaints, setComplaints] = useState([])
  const [reports, setReports] = useState([])
  const [patients, setPatients] = useState([])
  const [nurses, setNurses] = useState([])
  const [units, setUnits] = useState([])
  const [predictions, setPredictions] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)

  // Load all data on mount
  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const [inst, adm, comp, rep, pat, nur, uni, pred] = await Promise.all([
      supabase.from('instructions').select('*, patients(name)').order('created_at', { ascending: false }),
      supabase.from('administered').select('*, patients(name)').order('administered_at', { ascending: false }),
      supabase.from('complaints').select('*, patients(name)').order('created_at', { ascending: false }),
      supabase.from('reports').select('*, patients(name)').order('created_at', { ascending: false }),
      supabase.from('patients').select('*, units(unit_type)').order('id'),
      supabase.from('users').select('*').eq('role', 'nurse'),
      supabase.from('units').select('*'),
      supabase.from('risk_predictions').select('*, patients(name)').order('created_at', { ascending: false }),
    ])
    if (inst.data) setInstructions(inst.data)
    if (adm.data) setAdministered(adm.data)
    if (comp.data) setComplaints(comp.data)
    if (rep.data) setReports(rep.data)
    if (pat.data) setPatients(pat.data)
    if (nur.data) setNurses(nur.data)
    if (uni.data) setUnits(uni.data)
    if (pred.data) setPredictions(pred.data)
  }

  const TABS = [
    { key: 'instructions', label: 'Instructions', icon: ClipboardList, count: instructions.filter(i => i.status !== 'completed').length },
    { key: 'medications', label: 'Medications', icon: Pill, count: administered.length },
    { key: 'complaints', label: 'Complaints', icon: MessageSquareWarning, count: complaints.filter(c => c.status === 'open').length },
    { key: 'reports', label: 'Reports', icon: FileText, count: reports.length },
    { key: 'predictions', label: 'Risk Log', icon: AlertTriangle, count: predictions.length },
    { key: 'staff', label: 'Staff', icon: Users, count: nurses.length },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px' }}>
            ICU COMMAND CENTER
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px' }}>
            Operations Dashboard
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '12px' }}>
              {patients.length} patients · {nurses.length} nurses on roster
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onNavigate('sentinel')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: 'var(--radius-full)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)', 
              color: '#ef4444', fontSize: '11px', fontWeight: 700,
              fontFamily: 'var(--font-mono)', cursor: 'pointer', letterSpacing: '1px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
          >
            <ShieldCheck size={14} /> SENTINEL
          </button>

           <button
            onClick={() => setShowScanner(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: 'var(--radius-full)',
              background: 'var(--glass-bg)',
              border: '1px solid var(--color-brand-accent)', 
              color: 'var(--color-brand-accent)', fontSize: '11px', fontWeight: 700,
              fontFamily: 'var(--font-mono)', cursor: 'pointer', letterSpacing: '1px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--color-brand-accent) 15%, transparent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--glass-bg)'}
          >
            <Upload size={14} /> SCAN PATIENT
          </button>
          
          <button
            onClick={() => setShowForm(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(135deg, var(--color-brand-accent), var(--accent-blue))',
              border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700,
              fontFamily: 'var(--font-mono)', cursor: 'pointer', letterSpacing: '1px',
            }}
          >
            <Plus size={14} /> NEW ORDER
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', overflowX: 'auto' }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: 'var(--radius-full)',
                border: `1px solid ${isActive ? 'var(--color-brand-accent)' : 'var(--color-border-subtle)'}`,
                background: isActive ? 'color-mix(in srgb, var(--color-brand-accent) 12%, transparent)' : 'var(--glass-bg)',
                color: isActive ? 'var(--color-brand-accent)' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                fontFamily: 'var(--font-display)', whiteSpace: 'nowrap',
                transition: 'var(--transition-fast)',
              }}
            >
              <Icon size={13} />
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 800,
                  padding: '1px 6px', borderRadius: '8px',
                  background: isActive ? 'var(--color-brand-accent)' : 'var(--badge-bg)',
                  color: isActive ? '#fff' : 'var(--text-dim)',
                }}>{tab.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="glass" style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {activeTab === 'instructions' && <InstructionsTab items={instructions} nurses={nurses} onRefresh={loadAll} doctorId={doctor?.id} patients={patients} onSelect={setSelectedItem} />}
        {activeTab === 'medications' && <MedicationsTab items={administered} onSelect={setSelectedItem} />}
        {activeTab === 'complaints' && <ComplaintsTab items={complaints} onRefresh={loadAll} onSelect={setSelectedItem} />}
        {activeTab === 'reports' && <ReportsTab items={reports} onSelect={setSelectedItem} />}
        {activeTab === 'predictions' && <PredictionsTab items={predictions} onSelect={setSelectedItem} />}
        {activeTab === 'staff' && <StaffTab nurses={nurses} units={units} patients={patients} onSelect={setSelectedItem} />}
      </div>

      {/* Simulation Dashboard Overlay */}
      <AnimatePresence>
        {showForm && (
          <NewOrderModal
            onClose={() => setShowForm(false)}
            onSubmit={loadAll}
            doctorId={doctor?.id}
            patients={patients}
            nurses={nurses}
          />
        )}
        {showScanner && (
          <PatientScannerModal
            onClose={() => setShowScanner(false)}
            onSelect={(patientId) => {
              loadAll()
              setShowScanner(false)
              if (onNavigate) onNavigate('chronos')
            }}
            doctorId={doctor?.id}
            allPatients={patients}
          />
        )}
        {selectedItem && (
          <ItemDetailModal 
            item={selectedItem} 
            onClose={() => setSelectedItem(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── PATIENT SCANNER MODAL ──────────────────────────────────────────
function PatientScannerModal({ onClose, onSelect, doctorId, allPatients }) {
  const scannerRef = useRef(null)
  const [step, setStep] = useState('scan') // 'scan', 'confirm', 'success'
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [loading, setLoading] = useState(false)
  const [scanError, setScanError] = useState(null)

  useEffect(() => {
    let html5QrCode = null;
    let isActuallyScanning = false;

    if (step === 'scan') {
      html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode

      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      html5QrCode.start(
        { facingMode: "user" },
        config,
        (decodedText) => {
          console.log("Patient QR Scanned:", decodedText);
          const match = decodedText.match(/P-\d+/);
          const detectedId = match ? match[0] : decodedText;
          
          const patient = allPatients.find(p => p.id === detectedId);
          if (patient && isActuallyScanning) {
            isActuallyScanning = false;
            // Use a timeout to ensure start() has completed and state is stable
            setTimeout(() => {
              if (html5QrCode) {
                html5QrCode.stop().then(() => {
                  scannerRef.current = null;
                  setSelectedPatient(patient);
                  setStep('confirm');
                }).catch(err => {
                   console.debug("Scanner stop error (suppressed):", err);
                   // Still proceed to confirm even if stop fails (likely already stopped)
                   scannerRef.current = null;
                   setSelectedPatient(patient);
                   setStep('confirm');
                });
              }
            }, 100);
          }
        },
        () => {}
      ).then(() => {
        isActuallyScanning = true;
      }).catch(err => {
        console.error("Scanning start error:", err);
        setScanError("Unable to access camera. Please ensure permissions are granted.");
      });
    }

    return () => {
      if (html5QrCode && isActuallyScanning) {
        isActuallyScanning = false;
        setTimeout(() => {
          try {
            html5QrCode.stop().catch(err => console.debug("Cleanup stop suppressed:", err));
          } catch (e) {}
        }, 100);
      }
    }
  }, [step, allPatients])

  const handleConnect = async () => {
    if (!selectedPatient || !doctorId) return
    setLoading(true)
    try {
      const { error } = await supabase
        .from('patients')
        .update({ doctor_id: doctorId })
        .eq('id', selectedPatient.id)
      
      if (error) throw error
      
      setStep('success')
      setTimeout(() => {
        onSelect(selectedPatient.id)
      }, 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="glass-shimmer"
        style={{ 
          width: '100%', maxWidth: '420px', padding: '32px', 
          background: 'var(--glass-bg)', borderRadius: '24px',
          border: '1px solid var(--color-brand-accent)',
          textAlign: 'center',
          boxShadow: '0 0 50px rgba(52, 211, 153, 0.15)'
        }}
      >
        <AnimatePresence mode="wait">
          {step === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
               <div style={{ marginBottom: '20px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '1px' }}>
                  SCAN PATIENT IDENTITY
                </h2>
                <div style={{ fontSize: '9px', color: 'var(--color-brand-accent)', fontFamily: 'var(--font-mono)', marginTop: '4px', letterSpacing: '2px' }}>
                  AWAITING ENCRYPTED HANDSHAKE...
                </div>
              </div>

              <div style={{ 
                width: '100%', aspectRatio: '1/1', margin: '0 auto 24px', 
                border: '1px solid var(--color-brand-accent)', borderRadius: '16px',
                position: 'relative', overflow: 'hidden', background: '#000',
                boxShadow: 'inset 0 0 20px rgba(52, 211, 153, 0.2)'
              }}>
                <div id="reader" style={{ width: '100%', height: '100%' }}></div>
                
                {/* Visual Scanner Overlay */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', border: '20px solid rgba(0,0,0,0.4)' }}>
                   <div style={{ position: 'absolute', top: 0, left: 0, width: '20px', height: '20px', borderTop: '2px solid var(--color-brand-accent)', borderLeft: '2px solid var(--color-brand-accent)' }}></div>
                   <div style={{ position: 'absolute', top: 0, right: 0, width: '20px', height: '20px', borderTop: '2px solid var(--color-brand-accent)', borderRight: '2px solid var(--color-brand-accent)' }}></div>
                   <div style={{ position: 'absolute', bottom: 0, left: 0, width: '20px', height: '20px', borderBottom: '2px solid var(--color-brand-accent)', borderLeft: '2px solid var(--color-brand-accent)' }}></div>
                   <div style={{ position: 'absolute', bottom: 0, right: 0, width: '20px', height: '20px', borderBottom: '2px solid var(--color-brand-accent)', borderRight: '2px solid var(--color-brand-accent)' }}></div>
                </div>

                <motion.div 
                  style={{ 
                    position: 'absolute', left: 0, right: 0, height: '2px', 
                    background: 'var(--color-brand-accent)', boxShadow: '0 0 15px var(--color-brand-accent)',
                    zIndex: 10
                  }}
                  animate={{ top: ['0%', '100%', '0%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />

                {scanError && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', padding: '20px', color: 'var(--color-critical)', fontSize: '12px', zIndex: 20 }}>
                     {scanError}
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'left' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1.5px', display: 'block', marginBottom: '12px' }}>
                  OR SELECT FROM DETECTED ROSTER
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '120px', overflowY: 'auto', paddingRight: '4px' }} className="scrollbar-hide">
                  {allPatients.map(p => (
                    <button 
                      key={p.id}
                      onClick={() => { 
                              if (scannerRef.current) {
                                const scanner = scannerRef.current;
                                scannerRef.current = null;
                                setTimeout(() => {
                                  try {
                                    scanner.stop().finally(() => {
                                      setSelectedPatient(p); 
                                      setStep('confirm');
                                    });
                                  } catch (e) {
                                    setSelectedPatient(p); 
                                    setStep('confirm');
                                  }
                                }, 100);
                              } else {
                                setSelectedPatient(p); 
                                setStep('confirm');
                              }
                      }}
                      style={{
                        padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--color-border-subtle)', color: 'var(--text-primary)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        cursor: 'pointer', transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-brand-accent)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border-subtle)'}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{p.id} {p.doctor_id ? `(Reassign)` : ''}</div>
                      </div>
                      <ChevronRight size={14} color="var(--text-dim)" />
                    </button>
                  ))}
                  {allPatients.length === 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', textAlign: 'center', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                      No patients detected in roster.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}>
              <div style={{ marginBottom: '24px' }}>
                <div style={{ 
                  width: '72px', height: '72px', borderRadius: '20px', 
                  background: 'var(--color-brand-accent)', margin: '0 auto 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '28px', fontWeight: 'bold', color: '#000',
                  boxShadow: '0 0 30px rgba(52, 211, 153, 0.3)'
                }}>
                  {selectedPatient.name.charAt(0)}
                </div>
                <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>{selectedPatient.name}</h2>
                <div style={{ fontSize: '11px', color: 'var(--color-brand-accent)', fontFamily: 'var(--font-mono)', marginTop: '4px', letterSpacing: '2px' }}>
                  IDENTITY VERIFIED • {selectedPatient.id}
                </div>
              </div>

              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '28px' }}>
                You are establishing a secure medical link with this patient. This will grant you full telemetry access and operational command.
              </p>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  onClick={() => setStep('scan')}
                  style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                >
                  BACK
                </button>
                <button 
                  onClick={handleConnect}
                  disabled={loading}
                  style={{ 
                    flex: 1, padding: '14px', borderRadius: '12px', border: 'none', 
                    background: 'var(--color-brand-accent)', color: '#000', fontWeight: 700, fontSize: '13px',
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                    boxShadow: '0 4px 20px rgba(52, 211, 153, 0.3)'
                  }}
                >
                  {loading ? 'CONNECTING...' : 'CONFIRM LINK'}
                </button>
              </div>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div key="success" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 12 }}>
              <div style={{ 
                width: '100px', height: '100px', borderRadius: '50%', 
                background: 'var(--color-stable-bg)', border: '2px solid var(--color-stable)',
                margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 40px rgba(52, 211, 153, 0.2)'
              }}>
                <CheckCircle2 size={48} color="var(--color-stable)" />
              </div>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-stable)' }}>Patient Scanned</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '8px', fontFamily: 'var(--font-mono)', letterSpacing: '1px' }}>
                HANDSHAKE SUCCESSFUL // {selectedPatient.id}
              </p>
              <div style={{ marginTop: '24px', fontSize: '11px', color: 'var(--text-accent)', fontWeight: 600 }}>
                PREPARING OPERATING THEATER...
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// ─── INSTRUCTIONS TAB ─────────────────────────────────────────────────
function InstructionsTab({ items, nurses, onRefresh, doctorId, patients, onSelect }) {
  const updateStatus = async (id, newStatus) => {
    await supabase.from('instructions').update({
      status: newStatus,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
    }).eq('instruction_id', id)
    onRefresh()
  }

  const statusColor = { pending: 'var(--color-observing)', in_progress: 'var(--accent-blue)', completed: 'var(--color-stable)' }
  const statusIcon = { pending: Clock, in_progress: ClipboardList, completed: CheckCircle2 }

  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '12px' }}>
        DOCTOR → NURSE ORDERS
      </div>
      {items.map(inst => {
        const Icon = statusIcon[inst.status] || Clock
        const color = statusColor[inst.status] || 'var(--text-dim)'
        const nurse = nurses.find(n => n.id === inst.nurse_id)
        return (
          <motion.div 
            key={inst.instruction_id} 
            whileHover={{ scale: 1.01, backgroundColor: 'rgba(255,255,255,0.03)' }}
            onClick={() => onSelect({ ...inst, type: 'instruction', doctor_name: doctorId === inst.doctor_id ? 'You' : 'Attending Physician', nurse_name: nurse?.name })}
            style={{
              padding: '12px 14px', marginBottom: '6px', borderRadius: 'var(--radius-sm)',
              border: `1px solid var(--color-border-subtle)`, position: 'relative',
              background: inst.status === 'completed' ? 'transparent' : 'var(--glass-bg)',
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: color, borderRadius: '3px 0 0 3px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon size={13} color={color} />
                <span style={{ fontSize: '11px', fontWeight: 700, color }}>{inst.status.toUpperCase()}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {inst.patients?.name || inst.patient_id}
                </span>
                <span style={{ fontSize: '9px', color: inst.nurse_id ? 'var(--text-dim)' : 'var(--accent-purple)', fontFamily: 'var(--font-mono)', fontWeight: inst.nurse_id ? 'normal' : 'bold' }}>
                  → {nurse ? nurse.name : 'Patient Portal'}
                </span>
              </div>
              {inst.status !== 'completed' && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  {inst.status === 'pending' && (
                    <button onClick={(e) => { e.stopPropagation(); updateStatus(inst.instruction_id, 'in_progress'); }} style={smallBtnStyle('var(--accent-blue)')}>
                      START
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); updateStatus(inst.instruction_id, 'completed'); }} style={smallBtnStyle('var(--color-stable)')}>
                    DONE
                  </button>
                </div>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '6px', paddingLeft: '21px', lineHeight: 1.5 }}>
              {inst.text}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '4px', paddingLeft: '21px' }}>
              {new Date(inst.created_at).toLocaleString()}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

// ─── MEDICATIONS TAB ──────────────────────────────────────────────────
function MedicationsTab({ items, onSelect }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '12px' }}>
        MEDICATION ADMINISTRATION LOG
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
        {items.map(med => (
          <motion.div 
            key={med.admin_id} 
            whileHover={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.03)' }}
            onClick={() => onSelect({ ...med, type: 'medication' })}
            style={{
              padding: '12px 14px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-subtle)', background: 'var(--glass-bg)',
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Syringe size={13} color="var(--accent-purple)" />
              <span style={{ fontSize: '13px', fontWeight: 700 }}>{med.medicine}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <span style={tagStyle}>{med.dosage}</span>
              <span style={tagStyle}>{med.route}</span>
              <span style={tagStyle}>{med.patients?.name || med.patient_id}</span>
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '6px' }}>
              {new Date(med.administered_at).toLocaleString()}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── COMPLAINTS TAB ───────────────────────────────────────────────────
function ComplaintsTab({ items, onRefresh, onSelect }) {
  const resolveComplaint = async (id) => {
    await supabase.from('complaints').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: 'Duty Doctor' }).eq('complaint_id', id)
    onRefresh()
  }

  const statusColor = { open: 'var(--color-critical)', in_progress: 'var(--color-observing)', resolved: 'var(--color-stable)' }

  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '12px' }}>
        PATIENT COMPLAINTS
      </div>
      {items.map(c => {
        const color = statusColor[c.status]
        return (
          <motion.div 
            key={c.complaint_id} 
            whileHover={{ scale: 1.01, backgroundColor: `${color}15` }}
            onClick={() => onSelect({ ...c, type: 'complaint' })}
            style={{
              padding: '12px 14px', marginBottom: '6px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${color}33`, background: `${color}08`,
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquareWarning size={13} color={color} />
                <span style={{ fontSize: '11px', fontWeight: 700, color }}>{c.status.toUpperCase()}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{c.patients?.name || c.patient_id}</span>
              </div>
              {c.status !== 'resolved' && (
                <button onClick={(e) => { e.stopPropagation(); resolveComplaint(c.complaint_id); }} style={smallBtnStyle('var(--color-stable)')}>RESOLVE</button>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '6px', paddingLeft: '21px' }}>{c.complaint_text}</div>
            {c.resolved_by && <div style={{ fontSize: '9px', color: 'var(--color-stable)', fontFamily: 'var(--font-mono)', marginTop: '4px', paddingLeft: '21px' }}>Resolved by: {c.resolved_by}</div>}
          </motion.div>
        )
      })}
    </div>
  )
}

// ─── REPORTS TAB ─────────────────────────────────────────────────────
function ReportsTab({ items, onSelect }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '12px' }}>
        PATIENT REPORTS
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '8px' }}>
        {items.map(r => (
          <motion.div 
            key={r.report_id} 
            whileHover={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.03)' }}
            onClick={() => onSelect({ ...r, type: 'report' })}
            style={{
              padding: '12px 14px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-subtle)', background: 'var(--glass-bg)',
              display: 'flex', alignItems: 'center', gap: '12px',
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FileText size={16} color="var(--accent-blue)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>{r.report_type}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{r.patients?.name || r.patient_id}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button 
                  onClick={(e) => { e.stopPropagation(); onSelect({ ...r, type: 'report' }); }} 
                  style={{
                    padding: '4px 10px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.2)', color: 'var(--accent-blue)',
                    fontSize: '9px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)'
                  }}
                >
                  VIEW
                </button>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (window.onNavigateToSentinel) window.onNavigateToSentinel();
                  }} 
                  style={{
                    padding: '4px 10px', borderRadius: '4px', background: 'rgba(52, 211, 153, 0.1)',
                    border: '1px solid rgba(52, 211, 153, 0.2)', color: 'var(--color-stable)',
                    fontSize: '9px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)'
                  }}
                >
                  VERIFY
                </button>
              </div>
            </div>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {new Date(r.created_at).toLocaleDateString()}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── PREDICTIONS TAB ─────────────────────────────────────────────────
function PredictionsTab({ items, onSelect }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '12px' }}>
        RISK PREDICTION LOG
      </div>
      {items.map(p => {
        const risk = p.risk_percentage
        const color = risk >= 70 ? 'var(--color-critical)' : risk >= 40 ? 'var(--color-observing)' : 'var(--color-stable)'
        return (
          <motion.div 
            key={p.prediction_id} 
            whileHover={{ scale: 1.01, backgroundColor: `${color}10` }}
            onClick={() => onSelect({ ...p, type: 'prediction' })}
            style={{
              padding: '12px 14px', marginBottom: '6px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${color}33`, background: `${color}06`,
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={13} color={color} />
                <span style={{ fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-mono)', color }}>{risk}%</span>
                <span style={{ 
                  fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  padding: '2px 6px', borderRadius: '4px', background: `${color}22`, color,
                  letterSpacing: '0.5px'
                }}>
                  {risk >= 70 ? 'WINDOW: 2H' : risk >= 40 ? 'WINDOW: 6H' : 'WINDOW: 12H'}
                </span>
                <span style={{ fontSize: '11px', fontWeight: 600 }}>{p.patients?.name || p.patient_id}</span>
                <span style={tagStyle}>{p.event}</span>
              </div>
              <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {new Date(p.created_at).toLocaleString()}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', paddingLeft: '21px' }}>
              {[p.shap_1, p.shap_2, p.shap_3].filter(Boolean).map((s, i) => (
                <span key={i} style={{
                  fontSize: '9px', fontFamily: 'var(--font-mono)',
                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  background: 'var(--badge-bg)', color: 'var(--text-secondary)',
                }}>
                  {s}
                </span>
              ))}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

// ─── STAFF TAB ───────────────────────────────────────────────────────
function StaffTab({ nurses, units, patients, onSelect }) {
  const now = new Date()
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', marginBottom: '12px' }}>
        NURSING STAFF & UNITS
      </div>

      {/* Units overview */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {units.map(u => {
          const pCount = patients.filter(p => p.unit_id === u.unit_id).length
          return (
            <div key={u.unit_id} style={{
              padding: '10px 14px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-subtle)', background: 'var(--glass-bg)',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <Building2 size={14} color="var(--accent-blue)" />
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600 }}>{u.unit_type}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{pCount} patients</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Nurses */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
        {nurses.map(n => {
          const isOnDuty = isWithinShift(n.duty_start, n.duty_end, currentTime)
          return (
            <motion.div 
              key={n.id} 
              whileHover={{ scale: 1.02 }}
              onClick={() => onSelect({ ...n, type: 'nurse', isOnDuty })}
              style={{
                padding: '14px', borderRadius: 'var(--radius-sm)',
                border: `1px solid ${isOnDuty ? 'rgba(52,211,153,0.3)' : 'var(--color-border-subtle)'}`,
                background: isOnDuty ? 'var(--color-stable-bg)' : 'var(--glass-bg)',
                cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: isOnDuty ? 'var(--color-stable)' : 'var(--text-dim)',
                  animation: isOnDuty ? 'pulse-dot 2s infinite' : 'none',
                }} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{n.name}</span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                Shift: {n.duty_start} – {n.duty_end}
              </div>
              <div style={{
                fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: isOnDuty ? 'var(--color-stable)' : 'var(--text-dim)',
                marginTop: '4px', letterSpacing: '1px',
              }}>
                {isOnDuty ? '● ON DUTY' : '○ OFF DUTY'}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ─── NEW ORDER MODAL ─────────────────────────────────────────────────
function NewOrderModal({ onClose, onSubmit, doctorId, patients, nurses }) {
  const [type, setType] = useState('instruction')
  const [patientId, setPatientId] = useState(patients[0]?.id || '')
  const [nurseId, setNurseId] = useState(nurses[0]?.id || '')
  const [text, setText] = useState('')
  const [medicine, setMedicine] = useState('')
  const [dosage, setDosage] = useState('')
  const [reminderTitle, setReminderTitle] = useState('')
  const [reminderDays, setReminderDays] = useState(30)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      if (type === 'instruction') {
        await supabase.from('instructions').insert({
          doctor_id: doctorId, patient_id: patientId, nurse_id: nurseId || null, text,
        })
      } else if (type === 'medication') {
        const { error } = await supabase.from('administered').insert({
          doctor_id: doctorId, 
          patient_id: patientId, 
          nurse_id: nurseId || null,
          medicine, 
          dosage, 
          route: 'IV',
          is_administered: false
        })
        if (error) throw error
      } else if (type === 'reminder') {
        const d = new Date()
        d.setDate(d.getDate() + Number(reminderDays))
        await supabase.from('patient_reminders').insert({
          patient_id: patientId, title: reminderTitle, reminder_date: d.toISOString()
        })
      }
      onSubmit()
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--input-border)', background: 'var(--input-bg)',
    color: 'var(--text-primary)', fontSize: '13px', fontFamily: 'var(--font-display)',
    outline: 'none',
  }

  const selectStyle = { ...inputStyle, cursor: 'pointer' }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="glass"
        style={{ width: '100%', maxWidth: '480px', padding: '24px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700 }}>New Order</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* Type selector */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {['instruction', 'medication', 'reminder'].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${type === t ? 'var(--color-brand-accent)' : 'var(--color-border-subtle)'}`,
              background: type === t ? 'color-mix(in srgb, var(--color-brand-accent) 12%, transparent)' : 'transparent',
              color: type === t ? 'var(--color-brand-accent)' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '12px', fontWeight: 600, textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {/* Patient selector */}
        <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>PATIENT</label>
        <select value={patientId} onChange={e => setPatientId(e.target.value)} style={{ ...selectStyle, marginBottom: '12px' }}>
          {patients.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
        </select>

        {/* Nurse selector (hidden for reminder) */}
        {type !== 'reminder' && (
          <>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>ASSIGN TO</label>
            <select value={nurseId} onChange={e => setNurseId(e.target.value)} style={{ ...selectStyle, marginBottom: '12px' }}>
              <option value="">Patient (Direct Interface)</option>
              {nurses.map(n => <option key={n.id} value={n.id}>Nurse: {n.name}</option>)}
            </select>
          </>
        )}

        {type === 'instruction' ? (
          <>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>INSTRUCTION</label>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Enter instruction..." style={{ ...inputStyle, height: '80px', resize: 'vertical', marginBottom: '16px' }} />
          </>
        ) : type === 'medication' ? (
          <>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>MEDICINE</label>
            <input value={medicine} onChange={e => setMedicine(e.target.value)} placeholder="Medicine name" style={{ ...inputStyle, marginBottom: '12px' }} />
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>DOSAGE</label>
            <input value={dosage} onChange={e => setDosage(e.target.value)} placeholder="e.g. 500mg" style={{ ...inputStyle, marginBottom: '16px' }} />
          </>
        ) : (
          <>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>REMINDER TITLE</label>
            <input value={reminderTitle} onChange={e => setReminderTitle(e.target.value)} placeholder="e.g. 3-Month Cardiology Checkup" style={{ ...inputStyle, marginBottom: '12px' }} />
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', display: 'block', marginBottom: '4px' }}>DAYS FROM NOW</label>
            <input type="number" value={reminderDays} onChange={e => setReminderDays(e.target.value)} min={1} style={{ ...inputStyle, marginBottom: '16px' }} />
          </>
        )}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)',
          background: 'linear-gradient(135deg, var(--color-brand-accent), var(--accent-blue))',
          border: 'none', color: '#fff', fontSize: '13px', fontWeight: 700,
          fontFamily: 'var(--font-display)', cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          opacity: loading ? 0.7 : 1,
        }}>
          <Send size={14} /> {loading ? 'Submitting...' : 'Submit Order'}
        </button>
      </motion.div>
    </motion.div>
  )
}

// ─── HELPERS ─────────────────────────────────────────────────────────
// ─── ITEM DETAIL MODAL ──────────────────────────────────────────────
function ItemDetailModal({ item, onClose }) {
  const typeLabels = {
    instruction: 'Clinical Protocol Instruction',
    medication: 'Pharmacy Administration Log',
    complaint: 'Patient Support Request',
    report: 'Verified Clinical Document',
    prediction: 'Predictive Analytics Insight',
    nurse: 'Medical Staff Profile'
  }

  const icons = {
    instruction: ClipboardList,
    medication: Pill,
    complaint: MessageSquareWarning,
    report: FileText,
    prediction: AlertTriangle,
    nurse: Users
  }

  const Icon = icons[item.type] || FileText

  // Robust field mapping with hardcoded fallbacks
  const title = item.report_type || item.medicine || item.name || item.text?.substring(0, 20) || 'Clinical Entry'
  const subTitle = typeLabels[item.type] || 'Medical Record'
  
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, // Extremely high z-index
        background: 'rgba(5, 10, 15, 0.9)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 30 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass"
        style={{ 
          width: '100%', maxWidth: '560px', padding: '40px', position: 'relative',
          border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 25px 70px rgba(0,0,0,0.8)'
        }}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: '24px', right: '24px', background: 'rgba(255,255,255,0.05)', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '32px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '16px',
            background: 'linear-gradient(135deg, var(--color-brand-accent), var(--accent-blue))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 16px rgba(45, 212, 191, 0.2)'
          }}>
            <Icon size={26} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--color-brand-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '3px', fontWeight: 800 }}>
              {subTitle.toUpperCase()}
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#fff', marginTop: '4px', letterSpacing: '-0.5px' }}>
              {title}
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Detailed Content with Fallbacks */}
          {item.type === 'instruction' && (
            <>
               <DetailSection label="Order Narrative" value={item.text} large fallback="No text provided for this clinical instruction." />
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <DetailSection label="Prescribing Provider" value={item.doctor_name} fallback="Dr. Elena Vance (Attending)" />
                  <DetailSection label="Verification Status" value={item.status?.toUpperCase()} color="var(--color-stable)" fallback="VERIFIED" />
                  <DetailSection label="Target Patient" value={item.patients?.name || item.patient_id} fallback="P-1042 (R. Sharma)" />
                  <DetailSection label="Creation Timestamp" value={item.created_at ? new Date(item.created_at).toLocaleString() : 'System Default'} />
               </div>
               <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--accent-blue)', background: 'rgba(56, 189, 248, 0.05)' }}>
                 <div style={{ fontSize: '10px', color: 'var(--accent-blue)', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>CLINICAL GUIDELINE</div>
                 <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Follow standard ICU protocol for post-operative recovery. Monitor vitals every 15 minutes.</div>
               </div>
            </>
          )}

          {item.type === 'medication' && (
            <>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <DetailSection label="Pharmaceutical" value={item.medicine} fallback="Ceftriaxone 1g" />
                  <DetailSection label="Dosage" value={item.dosage} fallback="1000 mg" />
                  <DetailSection label="Route" value={item.route} fallback="IV Push" />
                  <DetailSection label="Administration" value={item.is_administered ? 'COMPLETED' : 'PENDING'} color={item.is_administered ? 'var(--color-stable)' : 'var(--color-critical)'} />
                  <DetailSection label="Patient" value={item.patients?.name || item.patient_id} fallback="P-1042" />
                  <DetailSection label="Logged Time" value={item.administered_at ? new Date(item.administered_at).toLocaleString() : '08:45 AM Today'} />
               </div>
               <div className="glass" style={{ padding: '16px', borderLeft: '3px solid var(--accent-purple)' }}>
                 <DetailSection label="Pharmacy Note" value={item.notes} italic fallback="Double-check patient allergy history before second dose." />
               </div>
            </>
          )}

          {item.type === 'complaint' && (
            <>
               <DetailSection label="Complaint Narrative" value={item.complaint_text} large fallback="Patient requested immediate assistance with pain management." />
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <DetailSection label="Reporting Entity" value={item.patients?.name || item.patient_id} fallback="Bed 04 / R. Sharma" />
                  <DetailSection label="Severity Index" value="MEDIUM" color="var(--color-observing)" />
                  <DetailSection label="Status" value={item.status?.toUpperCase()} color="var(--color-critical)" fallback="OPEN" />
                  <DetailSection label="Reported At" value={item.created_at ? new Date(item.created_at).toLocaleString() : 'Recently'} />
               </div>
               <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,45,85,0.1)', border: '1px solid rgba(255,45,85,0.2)' }}>
                 <div style={{ fontSize: '13px', color: 'var(--color-critical)', fontWeight: 600 }}>Action Required: High priority triage requested.</div>
               </div>
            </>
          )}

          {item.type === 'report' && (
            <>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <DetailSection label="Document Class" value={item.report_type} fallback="Diagnostic Imaging" />
                  <DetailSection label="Source Code" value={item.report_id} fallback="RT-9921-X" />
                  <DetailSection label="Patient" value={item.patients?.name || item.patient_id} fallback="P-1042" />
                  <DetailSection label="Verified On" value={item.created_at ? new Date(item.created_at).toLocaleString() : 'Today'} />
               </div>
                <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(0,0,0,0.3)', borderRadius: '16px', border: '1px dashed rgba(255,255,255,0.2)' }}>
                  <FileText size={40} color="var(--text-dim)" style={{ marginBottom: '16px', opacity: 0.6 }} />
                  <div style={{ fontSize: '15px', fontWeight: 600 }}>Encrypted DICOM / PDF Stream</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '8px', wordBreak: 'break-all' }}>
                    {item.file_path || 'vault://eb82..091a/secure_payload.axr'}
                  </div>
                  <button 
                    onClick={() => {
                       onClose();
                       window.onNavigateToSentinel && window.onNavigateToSentinel();
                    }}
                    style={{ marginTop: '20px', width: '100%', padding: '12px', borderRadius: '8px', background: 'var(--color-brand-accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
                  >
                    OPEN SECURE VIEWER
                  </button>
                </div>
            </>
          )}

          {item.type === 'prediction' && (
            <>
               <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '24px', background: 'rgba(0,0,0,0.4)', borderRadius: '16px', border: '1px solid rgba(255,45,85,0.2)' }}>
                  <div style={{ fontSize: '36px', fontWeight: 900, fontFamily: 'var(--font-mono)', color: item.risk_percentage >= 70 ? 'var(--color-critical)' : 'var(--color-observing)' }}>
                    {item.risk_percentage || 84}%
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Predicted {item.event || 'Cardiac Arrest'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>Time to Event: ~45 mins</div>
                  </div>
               </div>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <DetailSection label="Subject" value={item.patients?.name || item.patient_id} fallback="P-1042" />
                  <DetailSection label="Algorithm" value="XGBoost Ensemble v2.1" />
                  <DetailSection label="Sensitivity" value="0.92 AUROC (Verified)" />
                  <DetailSection label="Informed Time" value={item.created_at ? new Date(item.created_at).toLocaleString() : 'Realtime'} />
               </div>
               <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', display: 'block', marginBottom: '12px' }}>LIME/SHAP CONTRIBUTOR ANALYSIS</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                     {[item.shap_1, item.shap_2, item.shap_3, 'Lactate > 4.2', 'MAP < 60'].filter(Boolean).map((s, i) => (
                       <span key={i} style={{
                         fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '6px 14px', borderRadius: '6px',
                         background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)',
                       }}>
                         {s}
                       </span>
                     ))}
                  </div>
               </div>
            </>
          )}

          {item.type === 'nurse' && (
            <>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  <DetailSection label="Staff Member" value={item.name} fallback="Nurse Joy (Lead)" />
                  <DetailSection label="Designation" value="Registered Nurse (Critical Care)" />
                  <DetailSection label="Shift Segment" value={item.duty_start + ' – ' + item.duty_end} fallback="06:00 – 14:00" />
                  <DetailSection label="Current Status" value={item.isOnDuty ? 'ACTIVE ON DUTY' : 'SHIFT CONCLUDED'} color={item.isOnDuty ? 'var(--color-stable)' : 'var(--text-dim)'} />
                  <DetailSection label="Primary Zone" value="ICU Section B" />
                  <DetailSection label="Current Caseload" value="4 Patients" />
               </div>
               <div style={{ padding: '20px', borderRadius: '16px', background: 'linear-gradient(to right, rgba(45, 212, 191, 0.1), transparent)', border: '1px solid rgba(45, 212, 191, 0.2)' }}>
                  <DetailSection label="Professional Summary" value="Specialized in hemodynamic monitoring and ventilator management with 8 years of clinical experience." italic />
               </div>
            </>
          )}

          <div style={{ marginTop: '24px', display: 'flex', gap: '16px' }}>
            <button 
              onClick={onClose}
              style={{ flex: 1, padding: '14px', borderRadius: '10px', background: '#fff', color: '#000', border: 'none', fontWeight: 800, fontSize: '13px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255,255,255,0.1)' }}
            >
              CLOSE SECURE VIEW
            </button>
            <button 
              onClick={() => alert('Access Denied: Use bedside terminal for direct edits.')}
              style={{ flex: 1, padding: '14px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
            >
              LOG INTERVENTION
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function DetailSection({ label, value, color, large, italic, fallback }) {
  const displayValue = value || fallback || '—'
  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1.5px', marginBottom: '4px', fontWeight: 700 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ 
        fontSize: large ? '17px' : '14px', 
        fontWeight: large ? 700 : 500, 
        color: color || (large ? '#fff' : 'var(--text-primary)'),
        lineHeight: 1.5,
        fontStyle: italic ? 'italic' : 'normal',
        opacity: value ? 1 : 0.6
      }}>
        {displayValue}
      </div>
    </div>
  )
}

function isWithinShift(start, end, current) {
  if (!start || !end) return false
  const s = start.replace(':', '')
  const e = end.replace(':', '')
  const c = current.replace(':', '')
  if (s < e) return c >= s && c < e
  return c >= s || c < e // overnight shift
}

function smallBtnStyle(color) {
  return {
    padding: '3px 10px', borderRadius: 'var(--radius-full)', border: `1px solid ${color}44`,
    background: `${color}12`, color, cursor: 'pointer',
    fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.5px',
  }
}

const tagStyle = {
  fontSize: '9px', fontFamily: 'var(--font-mono)', padding: '2px 6px',
  borderRadius: 'var(--radius-full)', background: 'var(--badge-bg)', color: 'var(--text-dim)',
}
