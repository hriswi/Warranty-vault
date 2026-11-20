import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Brain, ChevronDown, FileSearch, Lock, Radar, ShieldCheck, Zap } from 'lucide-react';
import LightRays from '../components/ui/LightRays.jsx';

// ── Safe custom cursor — StrictMode-safe, no useRef-null crashes, graceful fallback ──
function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const supportsHover = typeof window !== 'undefined' &&
    window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  useEffect(() => {
    if (!supportsHover) return undefined;
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return undefined;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;
    let rafId = 0;
    let mounted = true;

    const onMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      try {
        dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
      } catch (_) { /* ignore */ }
    };

    const tick = () => {
      if (!mounted) return;
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      try {
        ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      } catch (_) { /* ignore */ }
      rafId = requestAnimationFrame(tick);
    };

    const onOver = (e) => {
      const target = e.target;
      try {
        if (target && (
          target.closest && (target.closest('button, a, [data-cursor], input, textarea, select, label') || target.onclick)
        )) {
          document.documentElement.classList.add('cursor-active');
        }
      } catch (_) { /* ignore */ }
    };
    const onOut = (e) => {
      try {
        const target = e.target;
        if (target && target.closest && target.closest('button, a, [data-cursor], input, textarea, select, label')) {
          document.documentElement.classList.remove('cursor-active');
        }
      } catch (_) { /* ignore */ }
    };

    try {
      window.addEventListener('mousemove', onMove, { passive: true });
      document.addEventListener('mouseover', onOver, { passive: true });
      document.addEventListener('mouseout', onOut, { passive: true });
      rafId = requestAnimationFrame(tick);
      document.documentElement.classList.add('has-custom-cursor');
    } catch (_) { /* ignore */ }

    return () => {
      mounted = false;
      try {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseover', onOver);
        document.removeEventListener('mouseout', onOut);
        document.documentElement.classList.remove('has-custom-cursor', 'cursor-active');
      } catch (_) { /* ignore */ }
    };
  }, [supportsHover]);

  if (!supportsHover) return null;
  return (
    <>
      <div ref={dotRef} className="site-cursor-dot" />
      <div ref={ringRef} className="site-cursor-ring" />
    </>
  );
}

const features = [
  ['01', Brain, 'Reasoning, not matching', 'Coverage, exclusions, product age, risk signals, and claim context considered together.'],
  ['02', FileSearch, 'Invoice to intelligence', 'Clean, structured product data from a scan, photo, or PDF — with confidence where it matters.'],
  ['03', Radar, 'Risk before failure', 'Product-level signals surface the warranties and devices that deserve attention next.'],
  ['04', ShieldCheck, 'Claim-ready decisions', 'Plain-language coverage guidance with the specific evidence behind every answer.'],
];

const steps = [
  ['01', 'Bring in the evidence', 'Upload an invoice, receipt, or product document.'],
  ['02', 'Map the product', 'The system recognizes the product, warranty window, and relevant terms.'],
  ['03', 'Reason across the details', 'Risk, fraud, coverage, and lifecycle context are evaluated together.'],
  ['04', 'Act with confidence', 'Get clear next steps, alerts, and decision-ready explanations.'],
];

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { element.classList.add('is-visible'); observer.unobserve(element); }
    }, { threshold: 0.14 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const update = () => setScrolled(window.scrollY > 16); update(); window.addEventListener('scroll', update, { passive: true }); return () => window.removeEventListener('scroll', update); }, []);
  return <nav className={`landing-nav ${scrolled ? 'is-scrolled' : ''}`}><div className="landing-shell nav-inner"><Link to="/" className="brand">WARRANTY VAULT</Link><div className="nav-actions"><Link to="/login" className="nav-link">Sign in</Link><Link to="/register" className="nav-cta">Get started <ArrowRight size={14}/></Link></div></div></nav>;
}

function Hero() {
  const goNext = () => document.querySelector('#intelligence')?.scrollIntoView({ behavior: 'smooth' });
  return <section className="hero"><LightRays className="light-rays" intensity={0.85}/><div className="hero-noise"/><div className="landing-shell hero-content"><div className="hero-copy"><p className="eyebrow hero-enter">AUTONOMOUS WARRANTY INTELLIGENCE</p><h1 className="hero-title" aria-label="Warranty Intelligence"><span>WARRANTY</span><span>INTELLIGENCE</span></h1><p className="hero-summary hero-enter">A decision system for the products you own — from invoice extraction to coverage clarity, fraud signals, and failure risk.</p><div className="hero-actions hero-enter"><Link to="/register" className="primary-button">Start tracking <ArrowRight size={16}/></Link><Link to="/login" className="secondary-button">Sign in</Link></div></div><aside className="hero-signal hero-enter" aria-label="Intelligence status"><span className="signal-pulse"/><div><small>INTELLIGENCE STATUS</small><strong>Monitoring your product graph</strong></div></aside></div><button className="scroll-cue" onClick={goNext} aria-label="Scroll to intelligence section"><span>Explore</span><ChevronDown size={16}/></button></section>;
}

function Intro() { const ref = useReveal(); return <section id="intelligence" className="section intro-section"><div ref={ref} className="landing-shell reveal intro-grid"><p className="eyebrow">THE COST OF NOT KNOWING</p><h2>Warranty data is everywhere.<br/><em>Clarity is not.</em></h2><p className="section-copy">A receipt should not be a dead document. Warranty Vault turns scattered proof of purchase into a living decision layer that can explain what is covered, what is at risk, and what to do next.</p></div></section>; }

function Pipeline() { const ref = useReveal(); return <section className="section pipeline-section"><div ref={ref} className="landing-shell reveal"><div className="section-heading"><div><p className="eyebrow">INTELLIGENCE PIPELINE</p><h2>One input.<br/>A complete picture.</h2></div><p className="section-copy">Each signal strengthens the next one, so a decision is useful rather than merely automated.</p></div><div className="pipeline"><span>INVOICE</span><i/><span>PRODUCT</span><i/><span>CONTEXT</span><i/><span>DECISION</span></div></div></section>; }

function Features() { const ref = useReveal(); return <section className="section"><div ref={ref} className="landing-shell reveal"><div className="section-heading"><div><p className="eyebrow">PRODUCT CAPABILITIES</p><h2>Built for the moments<br/>that need an answer.</h2></div></div><div className="feature-grid">{features.map(([number, Icon, title, text]) => <article className="feature-card" data-cursor key={number}><div className="feature-card-top"><span>{number}</span><Icon size={20}/></div><h3>{title}</h3><p>{text}</p><ArrowRight className="feature-arrow" size={17}/></article>)}</div></div></section>; }

function Reasoning() { const ref = useReveal(); return <section className="section reasoning-section"><div ref={ref} className="landing-shell reveal reasoning-grid"><div><p className="eyebrow">EXPLAINABLE REASONING</p><h2>Answers should<br/>show their work.</h2><p className="section-copy">Rather than giving you a black-box verdict, the system connects the evidence, policy conditions, and risk factors behind every recommendation.</p></div><div className="reasoning-panel"><div><small>CLAIM ASSESSMENT</small><span className="status">COVERAGE LIKELY</span></div><div className="reason-row"><span>Invoice integrity</span><b>Consistent — no flags</b></div><div className="reason-row"><span>Warranty window</span><b>Active · 184 days</b></div><div className="reason-row"><span>Damage exclusion</span><b>Not indicated</b></div><p>Recommendation: prepare a standard manufacturer claim with the original invoice.</p></div></div></section>; }

function Analytics() { const ref = useReveal(); return <section className="section analytics-section"><div ref={ref} className="landing-shell reveal"><div className="analytics-header"><p className="eyebrow">RISK &amp; INTEGRITY</p><h2>See what deserves<br/>your attention.</h2></div><div className="analytics-grid"><div className="metric"><span>EXPIRING SOON</span><strong>03</strong><p>Coverage windows closing in the next 30 days.</p></div><div className="metric"><span>CLAIM READINESS</span><strong>94<span>%</span></strong><p>Records have the evidence needed for a decision.</p></div><div className="metric"><span>INTEGRITY SIGNALS</span><strong>02</strong><p>Invoices worth a closer look before a claim.</p></div></div></div></section>; }

function HowItWorks() { const ref = useReveal(); return <section className="section"><div ref={ref} className="landing-shell reveal work-grid"><div><p className="eyebrow">HOW IT WORKS</p><h2>Quietly useful<br/>from day one.</h2></div><ol>{steps.map(([number, title, text]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></div></section>; }

function Security() { const ref = useReveal(); return <section className="section security-section"><div ref={ref} className="landing-shell reveal security-grid"><div><p className="eyebrow">SECURITY BY DESIGN</p><h2>Your data remains<br/>yours.</h2></div><div><Lock size={20}/><p>Upload invoices, review extracted details, and track warranty coverage with protected account access.</p><div className="security-notes"><span>Protected access</span><span>Scoped data rules</span><span>Secure file checks</span></div></div></div></section>; }

function CTA() { const ref = useReveal(); return <section className="final-cta"><div ref={ref} className="landing-shell reveal"><p className="eyebrow">READY WHEN YOU ARE</p><h2>Put every warranty<br/>to work.</h2><Link to="/register" className="primary-button">Create your account <ArrowRight size={16}/></Link></div></section>; }

function Footer() { return <footer className="landing-footer"><div className="landing-shell"><span className="brand">WARRANTY VAULT</span><span>Autonomous warranty intelligence</span><span>© {new Date().getFullYear()}</span></div></footer>; }

export default function LandingPage() { return <main className="landing-page"><CustomCursor/><Nav/><Hero/><Intro/><Pipeline/><Features/><Reasoning/><Analytics/><HowItWorks/><Security/><CTA/><Footer/></main>; }
