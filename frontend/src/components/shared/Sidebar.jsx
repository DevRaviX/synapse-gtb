import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Monitor, Shield, Settings, ChevronLeft, ChevronRight, LayoutDashboard, Menu } from 'lucide-react'
import { playNavClick } from '../../utils/sounds'

const NAV_ITEMS = [
  { id: 'chronos', label: 'Project Chronos', subtitle: 'ICU Command', icon: Monitor, iconSrc: '/images/ProjectChronos.png' },
  { id: 'sentinel', label: 'Project Sentinel', subtitle: 'Surgical Recorder', icon: Shield, iconSrc: '/images/ProjectSentinel.png' },
]

export default function Sidebar({ activeView, onNavigate, expanded, onToggleExpand }) {
  return (
    <nav className={`sidebar-nav ${expanded ? 'expanded' : ''}`}>
      {/* Toggle button */}
      <button
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          padding: '8px',
          marginBottom: '8px',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
      >
        {expanded ? <ChevronLeft size={18} /> : <Menu size={18} />}
      </button>

      {/* Separator */}
      <div style={{
        height: '1px',
        background: 'var(--sidebar-border)',
        margin: '0 4px 8px',
      }} />

      {/* Nav items */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {NAV_ITEMS.map(item => {
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              onClick={() => {
                playNavClick()
                onNavigate(item.id)
              }}
              title={!expanded ? item.label : undefined}
            >
              <img
                src={item.iconSrc}
                alt={item.label}
                className="sidebar-icon"
                style={{
                  width: '22px',
                  height: '22px',
                  objectFit: 'contain',
                  opacity: isActive ? 1 : 0.5,
                  filter: isActive ? 'drop-shadow(0 0 4px rgba(52,211,153,0.4))' : 'none',
                  transition: 'all 0.3s',
                }}
              />
              <span className="sidebar-label">{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Bottom: version pill */}
      <div style={{
        padding: '8px',
        textAlign: 'center',
        opacity: 0.3,
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)',
        letterSpacing: '1px',
      }}>
        {expanded ? 'v2.0 CINEMATIC' : 'v2'}
      </div>
    </nav>
  )
}
