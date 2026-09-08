/**
 * LoginPage.jsx — Premium auth page. Monochrome, minimal, enterprise feel.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { gsap } from 'gsap';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Check } from 'lucide-react';
import GoogleIcon from '../../components/ui/GoogleIcon.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';

function FirebaseErrorMessage(code) {
  const map = {
    'auth/invalid-credential':    'Invalid email or password.',
    'auth/user-not-found':        'No account found with this email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/too-many-requests':     'Too many attempts. Please wait before trying again.',
    'auth/user-disabled':         'This account has been disabled.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/network-request-failed':'Network error. Check your connection.',
  };
  return map[code] || 'An error occurred. Please try again.';
}

export default function LoginPage() {
  const { login, loginWithGoogle, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/dashboard';

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPwd, setShowPwd]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [signedIn, setSignedIn]   = useState(false);
  const [error, setError]         = useState('');
  const [notice, setNotice]       = useState('');

  const containerRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) {
      gsap.set(containerRef.current, { opacity: 0, y: 24 });
      gsap.to(containerRef.current, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', delay: 0.1 });
      return undefined;
    }
    // Brief "signed in" transition after a successful Google login.
    const delay = signedIn ? 800 : 0;
    const t = setTimeout(() => navigate(from, { replace: true }), delay);
    return () => clearTimeout(t);
  }, [isAuthenticated, signedIn]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(FirebaseErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (googleLoading || loading || signedIn) return;
    setError('');
    setNotice('');
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      setSignedIn(true);
    } catch (err) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setNotice('Google sign-in was cancelled.');
      } else {
        setError(FirebaseErrorMessage(code));
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: '#000' }}
    >
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex flex-col justify-between p-16 w-2/5"
        style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}
      >
        <Link to="/" className="font-equinox text-xs tracking-[0.25em] text-white/60">
          WARRANTY VAULT
        </Link>
        <div>
          <p className="text-white/20 text-xs font-mono tracking-[0.15em] uppercase mb-4">
            Autonomous intelligence
          </p>
          <h2
            className="font-equinox text-white leading-none"
            style={{ fontSize: '3.5rem', letterSpacing: '0.02em' }}
          >
            Every warranty.<br />
            <span className="text-white/35">Understood.</span>
          </h2>
        </div>
        <p className="text-white/20 text-xs font-mono">v2.0 · Local-first · Free</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div ref={containerRef} className="w-full max-w-[380px]">
          {/* Mobile logo */}
          <Link to="/" className="lg:hidden block font-equinox text-xs tracking-[0.25em] text-white/60 mb-12">
            WARRANTY VAULT
          </Link>

          <div className="mb-10">
            <h1
              className="font-equinox text-white mb-2"
              style={{ fontSize: '2rem', letterSpacing: '0.04em' }}
            >
              Sign in
            </h1>
            <p className="text-white/35 text-sm">Welcome back. Enter your credentials.</p>
          </div>

          {/* Google auth */}
          <button
            onClick={handleGoogle}
            disabled={googleLoading || loading || signedIn}
            className="w-full flex items-center justify-center gap-3 py-3 mb-6 rounded-md text-sm font-medium"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.7)',
              transition: 'background 200ms, border-color 200ms',
              cursor: googleLoading || loading || signedIn ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!googleLoading && !loading && !signedIn) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.17)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
            }}
          >
            {signedIn ? (
              <>
                <Check size={16} /> Signed in
              </>
            ) : googleLoading ? (
              <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin" />
            ) : (
              <>
                <GoogleIcon size={16} /> Continue with Google
              </>
            )}
          </button>

          {notice && (
            <p className="text-xs px-4 py-3 rounded-md mb-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
              {notice}
            </p>
          )}

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-white/07" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <span className="text-white/20 text-xs font-mono">or</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div className="relative">
              <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-11"
                autoComplete="email"
                autoFocus
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pl-11 pr-11"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
              >
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {/* Error */}
            {error && (
              <p
                className="text-xs px-4 py-3 rounded-md"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
              >
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || googleLoading}
              className="btn-primary w-full mt-2"
            >
              {loading ? (
                <div className="w-4 h-4 border border-black/20 border-t-black/60 rounded-full animate-spin" />
              ) : (
                <>Sign in <ArrowRight size={14} /></>
              )}
            </button>
          </form>

          {/* Footer links */}
          <div className="flex items-center justify-between mt-8">
            <Link
              to="/forgot-password"
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Forgot password?
            </Link>
            <Link
              to="/register"
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Create account →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
