import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ChronosView from './pages/ChronosView'
import SentinelView from './pages/SentinelView'
import CommandPalette from './components/CommandPalette'
import DoctorQuickAuth from './components/auth/DoctorQuickAuth'
import Sidebar from './components/shared/Sidebar'
import StatusBar from './components/shared/StatusBar'
import ThemeToggle from './components/shared/ThemeToggle'
import SplashScreen from './components/shared/SplashScreen'
import AmbientParticles from './components/shared/AmbientParticles'
import { ToastProvider, useToast } from './components/shared/NotificationToast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { playNavClick, playPaletteOpen } from './utils/sounds'
import { LogOut, Bell, Search } from 'lucide-react'
import './styles/index.css'

// Page transition variants
const pageVariants = {
  initial: { opacity: 0, scale: 0.98, y: 12 },
  enter: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -12 },
}

const pageTransition = {
  duration: 0.35,
  ease: [0.4, 0, 0.2, 1],
}

function AuthenticatedApp() {
  const { isAuthenticated, loading, doctor, logout } = useAuth()
  const [showPalette, setShowPalette] = useState(false)
  const [activeView, setActiveView] = useState('chronos')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  const [currentRisk, setCurrentRisk] = useState(0.5)

  // Global Cmd+K handler
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowPalette(v => {
          if (!v) playPaletteOpen()
          return !v
        })
      }
      if (e.key === 'Escape') setShowPalette(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const navigate = useCallback((view) => {
    playNavClick()
    setActiveView(view)
    setShowPalette(false)
  }, [])

  // Loading state
  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-abyss)',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: '2px solid rgba(52, 211, 153, 0.2)',
          borderTopColor: '#34d399',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Show Quick Auth if not authenticated
  if (!isAuthenticated) {
    return <DoctorQuickAuth />
  }

  // Show splash screen on first load after auth
  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />
  }

  const sidebarWidth = sidebarExpanded ? 220 : 64

  // Main authenticated dashboard
  return (
    <div style={{ 
      background: 'var(--bg-abyss)', 
      color: 'var(--text-primary)', 
      minHeight: '100vh', 
      fontFamily: 'var(--font-display)',
    }}>
      {/* Ambient particles */}
      <AmbientParticles riskLevel={currentRisk} />

      {/* Ambient background */}
      <div className="ambient-bg" />

      {/* Navigation Bar */}
      <nav className="bg-glass-texture" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: '56px',
        borderBottom: '1px solid var(--nav-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="/images/MasterBrandLogo.png" alt="Synapse Logo" style={{
            height: '32px',
            width: 'auto',
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 8px rgba(52, 211, 153, 0.2))',
          }} />
          <span style={{
            fontWeight: 700,
            fontSize: '18px',
            letterSpacing: '-0.3px',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
          }}>Synapse GTB</span>
          <span style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--badge-bg)',
            color: 'var(--text-dim)',
            letterSpacing: '1.5px',
          }}>BETA</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Doctor badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-stable-bg)',
            border: '1px solid rgba(52, 211, 153, 0.15)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-stable)',
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--color-stable)',
              boxShadow: '0 0 8px rgba(52, 211, 153, 0.6)',
              animation: 'pulse-dot 2s infinite',
            }} />
            {doctor?.name || 'Doctor'}
          </div>

          {/* Search button */}
          <button
            onClick={() => { playPaletteOpen(); setShowPalette(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              color: 'var(--text-secondary)',
              padding: '6px 14px',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              transition: 'var(--transition-smooth)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--glass-border-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <Search size={12} />
            <span>Search</span>
            <kbd style={{
              background: 'var(--kbd-bg)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              border: '1px solid var(--kbd-border)',
              color: 'var(--text-dim)',
            }}>⌘K</kbd>
          </button>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Logout button */}
          <button
            id="logout-btn"
            onClick={logout}
            title="Sign Out"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'var(--color-critical-bg)',
              border: '1px solid rgba(255, 45, 85, 0.12)',
              color: '#ff6b8a',
              cursor: 'pointer',
              transition: 'all 300ms',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 45, 85, 0.15)'
              e.currentTarget.style.borderColor = 'rgba(255, 45, 85, 0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-critical-bg)'
              e.currentTarget.style.borderColor = 'rgba(255, 45, 85, 0.12)'
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </nav>

      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        onNavigate={navigate}
        expanded={sidebarExpanded}
        onToggleExpand={() => setSidebarExpanded(e => !e)}
      />

      {/* Main Content with page transitions */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        paddingTop: '56px',
        paddingLeft: sidebarWidth,
        paddingBottom: '28px',
        height: '100vh',
        transition: 'padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <AnimatePresence mode="wait">
          {activeView === 'chronos' && (
            <motion.div
              key="chronos"
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              transition={pageTransition}
              style={{ height: '100%' }}
            >
              <ChronosView onRiskChange={setCurrentRisk} />
            </motion.div>
          )}
          {activeView === 'sentinel' && (
            <motion.div
              key="sentinel"
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              transition={pageTransition}
              style={{ height: '100%' }}
            >
              <SentinelView />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Command Palette */}
      <AnimatePresence>
        {showPalette && (
          <CommandPalette
            onClose={() => setShowPalette(false)}
            onNavigate={navigate}
            currentView={activeView}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AuthenticatedApp />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
