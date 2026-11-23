/**
 * DashboardLayout.jsx — Shell for all authenticated pages.
 * Left sidebar nav, top bar, theme toggle, notification bell.
 */
import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Upload, Shield, Clock,
  MessageSquare, Settings, LogOut, ChevronRight, TrendingUp, FileText, Menu, X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useProductSync } from '../../hooks/useProductSync.js';

const NAV_ITEMS = [
  { to: '/dashboard',           icon: LayoutGrid,    label: 'Overview',      end: true },
  { to: '/dashboard/products',  icon: FileText,       label: 'My Products' },
  { to: '/dashboard/upload',    icon: Upload,         label: 'Add Product' },
  { to: '/dashboard/expiring',  icon: Clock,          label: 'Expiring Soon' },
  { to: '/dashboard/risk',      icon: TrendingUp,     label: 'Risk Analysis' },
  { to: '/dashboard/agent',     icon: MessageSquare,  label: 'AI Assistant' },
];

function NavItem({ to, icon: Icon, label, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => [
        'flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm transition-all duration-150',
        isActive
          ? 'bg-white/08 text-white'
          : 'text-white/40 hover:text-white/70 hover:bg-white/04',
      ].join(' ')}
      style={({ isActive }) => ({ fontWeight: isActive ? 500 : 400 })}
    >
      {({ isActive }) => (
        <>
          <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: '#050505',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        width: '220px',
      }}
    >
      {/* Logo */}
      <div className="px-5 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="font-equinox text-[11px] tracking-[0.25em] text-white/70">
          WARRANTY VAULT
        </span>
        {onClose && (
          <button onClick={onClose} className="text-white/30 hover:text-white/70 lg:hidden">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} onClick={onClose} />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="px-3 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {/* User info */}
        <div className="flex items-center gap-3 px-3 py-2.5 mb-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-medium"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
          >
            {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-xs font-medium truncate">
              {user?.displayName || 'User'}
            </p>
            <p className="text-white/25 text-[11px] truncate">{user?.email}</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-[8px] text-white/35 hover:text-white/60 hover:bg-white/04 transition-all w-full text-sm"
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  const storageError = useProductSync();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0A0A0A' }}>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-col shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 z-50 lg:hidden">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-6 h-14 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#080808' }}
        >
          <button
            className="lg:hidden text-white/40 hover:text-white/70 transition-colors"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={18} />
          </button>

          <div className="flex-1" />
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          {storageError && <p role="alert" className="px-6 py-3 text-white/70 text-sm">{storageError} <button className="underline" onClick={() => window.dispatchEvent(new Event('focus'))}>Retry</button></p>}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
