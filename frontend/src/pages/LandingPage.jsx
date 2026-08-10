import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Brain, ChevronDown, FileSearch, Lock, Radar, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import LightRays from '../components/ui/LightRays.jsx';

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

function Cursor() {
  const dot = useRef(null); const ring = useRef(null);
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;
    let x = -100, y = -100, rx = -100, ry = -100, frame;
    const move = (event) => { x = event.clientX; y = event.clientY; };
    const over = (event) => document.body.classList.toggle('cursor-active', Boolean(event.target.closest('a, button, [data-cursor]')));
    const animate = () => { rx += (x - rx) * 0.16; ry += (y - ry) * 0.16; if (dot.current) dot.current.style.transform = `translate3d(${x}px,${y}px,0)`; if (ring.current) ring.current.style.transform = `translate3d(${rx}px,${ry}px,0)`; frame = requestAnimationFrame(animate); };
    window.addEventListener('pointermove', move, { passive: true }); window.addEventListener('pointerover', over, { passive: true }); frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerover', over); document.body.classList.remove('cursor-active'); };
  }, []);
  return <><span ref={dot} className="site-cursor-dot" /><span ref={ring} className="site-cursor-ring" /></>;
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

function Reasoning() { const ref = useReveal(); return <section className="section reasoning-section"><div ref={ref} className="landing-shell reveal reasoning-grid"><div><p className="eyebrow">EXPLAINABLE REASONING</p><h2>Answers should<br/>show their work.</h2><p className="section-copy">Rather than giving you a black-box verdict, the system connects the evidence, policy conditions, and risk factors behind every recommendation.</p></div><div className="reasoning-panel"><div><small>CLAIM ASSESSMENT</small><span className="status">COVERAGE LIKELY</span></div><div className="reason-row"><span>Invoice verified</span><b>Confirmed</b></div><div className="reason-row"><span>Warranty window</span><b>Active · 184 days</b></div><div className="reason-row"><span>Damage exclusion</span><b>Not indicated</b></div><p>Recommendation: prepare a standard manufacturer claim with the original invoice.</p></div></div></section>; }

function Analytics() { const ref = useReveal(); return <section className="section analytics-section"><div ref={ref} className="landing-shell reveal"><div className="analytics-header"><p className="eyebrow">RISK &amp; INTEGRITY</p><h2>See what deserves<br/>your attention.</h2></div><div className="analytics-grid"><div className="metric"><span>EXPIRING SOON</span><strong>03</strong><p>Coverage windows closing in the next 30 days.</p></div><div className="metric"><span>CLAIM READINESS</span><strong>94<span>%</span></strong><p>Records have the evidence needed for a decision.</p></div><div className="metric"><span>INTEGRITY SIGNALS</span><strong>02</strong><p>Invoices worth a closer look before a claim.</p></div></div></div></section>; }

function HowItWorks() { const ref = useReveal(); return <section className="section"><div ref={ref} className="landing-shell reveal work-grid"><div><p className="eyebrow">HOW IT WORKS</p><h2>Quietly useful<br/>from day one.</h2></div><ol>{steps.map(([number, title, text]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></div></section>; }

function Security() { const ref = useReveal(); return <section className="section security-section"><div ref={ref} className="landing-shell reveal security-grid"><div><p className="eyebrow">SECURITY BY DESIGN</p><h2>Your data remains<br/>yours.</h2></div><div><Lock size={20}/><p>Designed around protected accounts, strict data access rules, and local-first intelligence. Your warranty record should be useful without becoming another privacy trade-off.</p><div className="security-notes"><span>Protected access</span><span>Scoped data rules</span><span>Secure file checks</span></div></div></div></section>; }

function CTA() { const ref = useReveal(); return <section className="final-cta"><div ref={ref} className="landing-shell reveal"><Sparkles size={18}/><p className="eyebrow">READY WHEN YOU ARE</p><h2>Put every warranty<br/>to work.</h2><Link to="/register" className="primary-button">Create your account <ArrowRight size={16}/></Link></div></section>; }

function Footer() { return <footer className="landing-footer"><div className="landing-shell"><span className="brand">WARRANTY VAULT</span><span>Autonomous warranty intelligence</span><span>© {new Date().getFullYear()}</span></div></footer>; }

export default function LandingPage() { return <main className="landing-page"><Cursor/><Nav/><Hero/><Intro/><Pipeline/><Features/><Reasoning/><Analytics/><HowItWorks/><Security/><CTA/><Footer/></main>; }
