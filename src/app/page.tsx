'use client';

import { useEffect, useState } from 'react';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import Image from 'next/image';
import { authDestination, useAppAuth } from '@/lib/auth/provider';
import { useRouter } from 'next/navigation';

/* ── Fonts ─────────────────────────────────────── */
const sg = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const it = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] });
const jb = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'] });

/* ── Stars ─────────────────────────────────────── */
const STARS = Array.from({ length: 90 }, (_, i) => ({
  id: i,
  top: `${(i * 17 + 3) % 100}%`,
  left: `${(i * 23 + 7) % 100}%`,
  size: ((i % 3) + 0.5) * 0.7,
  delay: `${(i * 0.37) % 4}s`,
  duration: `${2.8 + (i % 5) * 0.5}s`,
}));

/* ── Icon helpers ───────────────────────────────── */
function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

/* ════════════════════════════════════════════════ */
export default function Home() {
  const { user, isLoaded } = useAppAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && user) router.replace(authDestination(user.role));
  }, [isLoaded, user, router]);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ── Nav links ─────────────────────────────────── */
  const NAV_LINKS = [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'For Families', href: '#families' },
    { label: 'For Companions', href: '#companions' },
    { label: 'Safety', href: '#safety' },
  ];

  return (
    <div
      style={{
        backgroundColor: '#07080d',
        minHeight: '100vh',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* ── Global stars ─────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {STARS.map((s) => (
          <span
            key={s.id}
            className="tb-star"
            style={{
              position: 'absolute',
              top: s.top,
              left: s.left,
              width: `${s.size}px`,
              height: `${s.size}px`,
              borderRadius: '50%',
              backgroundColor: '#fff',
              animationDelay: s.delay,
              animationDuration: s.duration,
            }}
          />
        ))}
      </div>

      {/* ── Ambient glows ────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      >
        <div style={{
          position: 'absolute',
          top: '-10%',
          left: '-5%',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(37,224,255,0.055) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-10%',
          right: '-5%',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,46,136,0.05) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }} />
      </div>

      {/* ════════════════════════════════════════════════
          NAVIGATION
      ════════════════════════════════════════════════ */}
      <nav
        className={scrolled ? 'tb-nav-glass' : ''}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          transition: 'background 0.3s, border-color 0.3s',
          backgroundColor: scrolled ? undefined : 'transparent',
        }}
      >
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 32px',
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '24px',
        }}>
          {/* Brand */}
          <a href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
            <span
              className={sg.className}
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                background: 'linear-gradient(135deg,#fff,#eaeefb)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              TravelBuddy
            </span>
            <span style={{ color: '#ff2e88', fontWeight: 700, fontSize: '1.375rem', marginLeft: '1px' }}>.</span>
          </a>

          {/* Desktop center nav — always flex on md+ */}
          <div
            className={it.className}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '32px',
            }}
            id="desktop-nav"
          >
            {/* Hide on mobile via media query class */}
            <style>{`
              @media (max-width: 767px) {
                #desktop-nav { display: none !important; }
                #desktop-ctas { display: none !important; }
                #mobile-toggle { display: flex !important; }
              }
            `}</style>
            {NAV_LINKS.map((l) => (
              <a key={l.label} href={l.href} className="tb-nav-link">
                {l.label}
              </a>
            ))}
          </div>

          {/* Desktop right CTAs */}
          <div
            id="desktop-ctas"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}
          >
            <a href="/auth/sign-in" className="tb-nav-link">Sign in</a>
            <a href="/auth/sign-up" className="tb-btn-primary" style={{ padding: '9px 20px' }}>
              Get started
            </a>
          </div>

          {/* Mobile toggle — hidden on desktop via media query above */}
          <div id="mobile-toggle" style={{ display: 'none', alignItems: 'center', gap: '8px' }}>
            <a href="/auth/sign-up" className="tb-btn-primary" style={{ padding: '8px 16px', fontSize: '0.8125rem' }}>
              Get started
            </a>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '8px',
                cursor: 'pointer',
                color: '#818ca9',
                display: 'flex',
              }}
              aria-label="Toggle menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {mobileMenuOpen
                  ? <><path d="M6 18L18 6"/><path d="M6 6l12 12"/></>
                  : <><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></>
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileMenuOpen && (
          <div
            className="tb-nav-glass"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.05)',
              padding: '12px 32px 16px',
            }}
          >
            {[...NAV_LINKS, { label: 'Sign in', href: '/auth/sign-in' }].map((l) => (
              <a
                key={l.label}
                href={l.href}
                className={`tb-nav-link ${it.className}`}
                style={{
                  display: 'block',
                  padding: '10px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                onClick={() => setMobileMenuOpen(false)}
              >
                {l.label}
              </a>
            ))}
          </div>
        )}
      </nav>

      {/* ════════════════════════════════════════════════
          HERO — strict two-column desktop layout
      ════════════════════════════════════════════════ */}
      <section
        style={{
          position: 'relative',
          zIndex: 10,
          paddingTop: '64px', /* nav height */
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {/* Two-column grid container */}
        <div
          style={{
            maxWidth: '1400px',
            width: '100%',
            margin: '0 auto',
            padding: '60px 32px',
            display: 'grid',
            gridTemplateColumns: '0.9fr 1.1fr',
            alignItems: 'center',
            gap: '48px',
            minHeight: '720px',
          }}
          className="hero-grid"
        >
          {/* ── Left column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

            {/* Eyebrow */}
            <div className="tb-eyebrow">
              <span
                className="tb-pulse-dot"
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#25e0ff',
                  boxShadow: '0 0 8px #25e0ff',
                  flexShrink: 0,
                }}
              />
              <span className={jb.className}>Verified Companions</span>
            </div>

            {/* Headline */}
            <h1
              className={`${sg.className} tb-text-chrome`}
              style={{
                fontSize: 'clamp(2.75rem, 4.5vw, 4.25rem)',
                fontWeight: 700,
                lineHeight: 1.04,
                letterSpacing: '-0.025em',
                margin: 0,
              }}
            >
              Safe journeys.<br />
              Trusted companions.
            </h1>

            {/* Supporting copy */}
            <p
              className={it.className}
              style={{
                fontSize: '1.0625rem',
                lineHeight: 1.7,
                color: '#818ca9',
                maxWidth: '44ch',
                margin: 0,
              }}
            >
              TravelBuddy connects elderly travelers with verified companions who help make every journey safer, simpler and more comfortable.
            </p>

            {/* CTA buttons — compact, side-by-side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <a href="/auth/sign-up" className={`tb-btn-primary ${it.className}`}>
                Find a TravelBuddy&nbsp;<ArrowRight />
                {/* shimmer */}
                <span
                  className="tb-shimmer"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)',
                    pointerEvents: 'none',
                  }}
                />
              </a>
              <a href="#how-it-works" className={`tb-btn-secondary ${it.className}`}>
                Explore how it works
              </a>
            </div>

            {/* Trust line */}
            <p
              className={it.className}
              style={{ fontSize: '0.8125rem', color: '#4b5568', margin: 0 }}
            >
              Verified companions&nbsp;&nbsp;•&nbsp;&nbsp;Safety-first matching&nbsp;&nbsp;•&nbsp;&nbsp;Built for peace of mind
            </p>
          </div>

          {/* ── Right column: Earth ── */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Atmospheric glow behind earth */}
            <div
              className="tb-earth-glow"
              style={{
                position: 'absolute',
                inset: '-60px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(37,224,255,0.1) 0%, rgba(46,99,255,0.06) 50%, transparent 72%)',
                filter: 'blur(48px)',
                pointerEvents: 'none',
              }}
            />

            {/* Orbit ring 1 */}
            <div
              className="tb-orbit-1"
              style={{
                position: 'absolute',
                inset: '-32px',
                borderRadius: '50%',
                border: '1px solid rgba(37,224,255,0.16)',
                pointerEvents: 'none',
              }}
            />
            {/* Orbit ring 2 */}
            <div
              className="tb-orbit-2"
              style={{
                position: 'absolute',
                inset: '-18px',
                borderRadius: '50%',
                border: '1px solid rgba(255,46,136,0.11)',
                pointerEvents: 'none',
              }}
            />

            {/* Earth image */}
            <div
              style={{
                position: 'relative',
                width: 'clamp(320px, 44vw, 540px)',
                height: 'clamp(320px, 44vw, 540px)',
                borderRadius: '50%',
                overflow: 'hidden',
                boxShadow: '0 0 60px 12px rgba(37,224,255,0.22), 0 0 120px 28px rgba(46,99,255,0.12)',
                flexShrink: 0,
              }}
            >
              <Image
                src="/assets/earth.jpg"
                alt="Earth from space — TravelBuddy connects the world"
                fill
                priority
                style={{ objectFit: 'cover', objectPosition: 'center' }}
                sizes="(max-width: 768px) 85vw, 44vw"
              />
              {/* Atmospheric edge shimmer */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 28% 28%, transparent 55%, rgba(37,224,255,0.1) 80%, rgba(37,224,255,0.22) 100%)',
                  pointerEvents: 'none',
                  mixBlendMode: 'screen',
                }}
              />
            </div>

            {/* Floating accent dots */}
            {[
              { top: '8%',  left: '4%',  size: 5, color: '#25e0ff', delay: '0s' },
              { top: '82%', left: '6%',  size: 4, color: '#ff2e88', delay: '1.3s' },
              { top: '10%', right: '4%', size: 4, color: '#2e63ff', delay: '2.1s' },
              { top: '75%', right: '5%', size: 5, color: '#25e0ff', delay: '0.7s' },
            ].map((d, i) => (
              <span
                key={i}
                className="tb-float"
                style={{
                  position: 'absolute',
                  top: d.top,
                  left: (d as { left?: string }).left,
                  right: (d as { right?: string }).right,
                  width: d.size,
                  height: d.size,
                  borderRadius: '50%',
                  backgroundColor: d.color,
                  boxShadow: `0 0 8px 2px ${d.color}90`,
                  animationDelay: d.delay,
                  pointerEvents: 'none',
                }}
              />
            ))}
          </div>
        </div>

        {/* Mobile responsive: stack hero vertically */}
        <style>{`
          @media (max-width: 767px) {
            .hero-grid {
              grid-template-columns: 1fr !important;
              padding: 40px 20px !important;
              gap: 40px !important;
              min-height: unset !important;
            }
          }
        `}</style>
      </section>

      {/* ════════════════════════════════════════════════
          TRUST STRIP
      ════════════════════════════════════════════════ */}
      <section
        style={{
          position: 'relative',
          zIndex: 10,
          borderTop: '1px solid rgba(255,255,255,0.055)',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
          padding: '20px 0',
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 0,
            }}
            className="trust-grid"
          >
            <style>{`
              @media (max-width: 600px) {
                .trust-grid { grid-template-columns: repeat(2, 1fr) !important; }
              }
            `}</style>
            {[
              { label: 'VERIFIED COMPANIONS', color: '#25e0ff', icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg> },
              { label: 'SECURE BOOKINGS',     color: '#ff2e88', icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> },
              { label: 'SAFETY-FIRST MATCHING', color: '#2e63ff', icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg> },
              { label: 'TRIP CHECK-INS',      color: '#25e0ff', icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg> },
            ].map((item, idx) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '16px 12px',
                  borderRight: idx < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}
              >
                <span style={{ color: item.color, flexShrink: 0 }}>{item.icon}</span>
                <span
                  className={jb.className}
                  style={{ fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '0.12em', color: '#818ca9' }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          HOW IT WORKS — 3 cards
      ════════════════════════════════════════════════ */}
      <section id="how-it-works" style={{ position: 'relative', zIndex: 10, padding: '100px 0' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>

          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <div className={`tb-eyebrow ${jb.className}`} style={{ justifyContent: 'center', marginBottom: '16px' }}>
              How it works
            </div>
            <h2
              className={`${sg.className} tb-section-heading tb-text-chrome`}
              style={{ margin: 0 }}
            >
              Three steps to safer travel.
            </h2>
          </div>

          {/* Cards grid */}
          <div
            className="cards-3"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}
          >
            <style>{`
              @media (max-width: 767px) { .cards-3 { grid-template-columns: 1fr !important; } }
            `}</style>
            {[
              {
                num: '01',
                title: 'Create a trip',
                body: 'Families add traveler information, destination, dates and assistance needs. We handle the rest.',
                color: '#25e0ff',
                icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>,
              },
              {
                num: '02',
                title: 'Meet the right companion',
                body: 'Matching considers route, language, assistance needs and availability to find the ideal companion.',
                color: '#ff2e88',
                icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>,
              },
              {
                num: '03',
                title: 'Travel with confidence',
                body: 'Trip updates, check-ins and safety functionality keep everyone connected throughout the journey.',
                color: '#2e63ff',
                icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>,
              },
            ].map((card) => (
              <div
                key={card.num}
                className="tb-glass-card"
                style={{
                  padding: '36px 32px',
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'default',
                }}
              >
                {/* Top highlight line */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
                  background: `linear-gradient(90deg, transparent, ${card.color}55, transparent)`,
                }} />
                {/* Big number */}
                <span
                  className={jb.className}
                  style={{
                    position: 'absolute', top: '20px', right: '24px',
                    fontSize: '4.5rem', fontWeight: 400, lineHeight: 1,
                    color: 'rgba(255,255,255,0.035)',
                    userSelect: 'none',
                  }}
                >
                  {card.num}
                </span>
                {/* Icon */}
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: `${card.color}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: card.color, marginBottom: '24px',
                }}>
                  {card.icon}
                </div>
                <h3
                  className={sg.className}
                  style={{ fontSize: '1.125rem', fontWeight: 600, color: '#eaeefb', margin: '0 0 12px' }}
                >
                  {card.title}
                </h3>
                <p
                  className={it.className}
                  style={{ fontSize: '0.9375rem', lineHeight: 1.65, color: '#818ca9', margin: 0 }}
                >
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          FAMILIES & TRAVELERS — 2-col split
      ════════════════════════════════════════════════ */}
      <section id="families" style={{ position: 'relative', zIndex: 10, padding: '100px 0' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>
          <div
            className="split-grid"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '64px' }}
          >
            <style>{`
              @media (max-width: 767px) { .split-grid { grid-template-columns: 1fr !important; gap: 40px !important; } }
            `}</style>

            {/* Visual — route map */}
            <div style={{
              position: 'relative', height: '420px', borderRadius: '20px', overflow: 'hidden',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {/* Grid lines */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.05 }} viewBox="0 0 500 420" preserveAspectRatio="none">
                {Array.from({ length: 9 }).map((_, i) => <line key={`v${i}`} x1={i * 62} y1="0" x2={i * 62} y2="420" stroke="white" strokeWidth="0.8"/>)}
                {Array.from({ length: 8 }).map((_, i) => <line key={`h${i}`} x1="0" y1={i * 60} x2="500" y2={i * 60} stroke="white" strokeWidth="0.8"/>)}
              </svg>
              {/* Glow */}
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 35% 45%, rgba(37,224,255,0.08) 0%, transparent 60%)' }} />
              {/* Route SVG */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 500 420">
                <defs>
                  <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#25e0ff" stopOpacity="0.9"/>
                    <stop offset="100%" stopColor="#ff2e88" stopOpacity="0.9"/>
                  </linearGradient>
                </defs>
                <path d="M 100 320 Q 250 100 400 320" fill="none" stroke="url(#rg)" strokeWidth="1.5" strokeDasharray="5 5"/>
                {/* Origin */}
                <circle cx="100" cy="320" r="7" fill="#25e0ff" fillOpacity="0.95"/>
                <circle cx="100" cy="320" r="14" fill="#25e0ff" fillOpacity="0.15"/>
                <circle cx="100" cy="320" r="22" fill="#25e0ff" fillOpacity="0.06"/>
                {/* Dest */}
                <circle cx="400" cy="320" r="7" fill="#ff2e88" fillOpacity="0.95"/>
                <circle cx="400" cy="320" r="14" fill="#ff2e88" fillOpacity="0.15"/>
                {/* Plane */}
                <g transform="translate(235, 155)">
                  <circle cx="15" cy="15" r="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
                  <text x="15" y="20" textAnchor="middle" fill="white" fontSize="14" fontFamily="sans-serif">✈</text>
                </g>
              </svg>
              {/* Labels */}
              <div style={{ position: 'absolute', bottom: '24px', left: '24px' }}>
                <span className={jb.className} style={{ fontSize: '0.7rem', color: '#25e0ff' }}>● Origin</span>
              </div>
              <div style={{ position: 'absolute', bottom: '24px', right: '24px', textAlign: 'right' }}>
                <span className={jb.className} style={{ fontSize: '0.7rem', color: '#ff2e88' }}>● Destination</span>
              </div>
              {/* Companion card */}
              <div style={{
                position: 'absolute', top: '20px', right: '20px',
                background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(14px)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px',
                padding: '14px 16px', minWidth: '160px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg,#25e0ff,#2e63ff)', flexShrink: 0 }}/>
                  <div>
                    <p className={it.className} style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#eaeefb', margin: 0 }}>Sarah M.</p>
                    <p className={it.className} style={{ fontSize: '0.75rem', color: '#818ca9', margin: 0 }}>Verified companion</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill="#25e0ff"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  ))}
                  <span className={it.className} style={{ fontSize: '0.75rem', color: '#818ca9', marginLeft: '4px' }}>5.0</span>
                </div>
              </div>
            </div>

            {/* Content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <div className={`tb-eyebrow ${jb.className}`} style={{ marginBottom: '14px', color: '#ff2e88' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff2e88' }}/>
                  Families &amp; Travelers
                </div>
                <h2 className={`${sg.className} tb-section-heading tb-text-chrome`} style={{ margin: 0 }}>
                  Peace of mind for every journey.
                </h2>
              </div>
              <p className={it.className} style={{ fontSize: '1rem', lineHeight: 1.7, color: '#818ca9', margin: 0 }}>
                Give your loved ones the freedom to travel with confidence, knowing they have a trusted companion every step of the way.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  { label: 'Create traveler profiles', color: '#25e0ff' },
                  { label: 'Request assistance', color: '#ff2e88' },
                  { label: 'Find verified companions', color: '#2e63ff' },
                  { label: 'Track trip progress', color: '#25e0ff' },
                ].map((item) => (
                  <div key={item.label} className="tb-feature-bullet">
                    <div className="tb-feature-bullet-dot" style={{ background: `${item.color}20` }}>
                      <CheckIcon color={item.color} />
                    </div>
                    <span className={`${it.className} tb-feature-label`}>{item.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ paddingTop: '4px' }}>
                <a href="/auth/sign-up" className={`tb-btn-primary ${it.className}`} style={{ alignSelf: 'flex-start' }}>
                  Get started for free&nbsp;<ArrowRight />
                  <span className="tb-shimmer" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)', pointerEvents: 'none' }}/>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          COMPANIONS — reversed 2-col split
      ════════════════════════════════════════════════ */}
      <section id="companions" style={{ position: 'relative', zIndex: 10, padding: '100px 0' }}>
        <div style={{
          position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 75% 50%, rgba(255,46,136,0.04) 0%, transparent 60%)',
        }}/>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>
          <div
            className="split-grid-rev"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '64px' }}
          >
            <style>{`@media (max-width: 767px) { .split-grid-rev { grid-template-columns: 1fr !important; gap: 40px !important; } }`}</style>

            {/* Content — left */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <div className={`tb-eyebrow ${jb.className}`} style={{ marginBottom: '14px', color: '#ff2e88' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff2e88' }}/>
                  For Companions
                </div>
                <h2 className={`${sg.className} tb-section-heading tb-text-chrome`} style={{ margin: 0 }}>
                  Turn your travel experience into meaningful support.
                </h2>
              </div>
              <p className={it.className} style={{ fontSize: '1rem', lineHeight: 1.7, color: '#818ca9', margin: 0 }}>
                Join a growing community of verified companions helping elderly travelers experience the world safely and confidently.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  { label: 'Build a companion profile', color: '#ff2e88' },
                  { label: 'Set availability', color: '#2e63ff' },
                  { label: 'Complete verification', color: '#25e0ff' },
                  { label: 'Receive relevant matches', color: '#ff2e88' },
                ].map((item) => (
                  <div key={item.label} className="tb-feature-bullet">
                    <div className="tb-feature-bullet-dot" style={{ background: `${item.color}20` }}>
                      <CheckIcon color={item.color} />
                    </div>
                    <span className={`${it.className} tb-feature-label`}>{item.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ paddingTop: '4px' }}>
                <a href="/auth/sign-up" className={`tb-btn-primary ${it.className}`} style={{ background: 'linear-gradient(135deg,#ff2e88 0%,#9b2dff 100%)' }}>
                  Become a companion&nbsp;<ArrowRight />
                  <span className="tb-shimmer" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)', pointerEvents: 'none' }}/>
                </a>
              </div>
            </div>

            {/* Visual — profile card stack */}
            <div style={{ position: 'relative', height: '420px' }}>
              <div style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: '280px', height: '280px', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(255,46,136,0.1) 0%, transparent 70%)',
                filter: 'blur(60px)', pointerEvents: 'none',
              }}/>
              {[
                { name: 'Priya R.', role: 'Hindi, English', rating: 4.9, trips: 47, top: '5%',  left: '5%',  rotate: '-5deg', z: 1, ac: '#ff2e88' },
                { name: 'James K.', role: 'English, Swahili', rating: 5.0, trips: 83, top: '20%', left: '25%', rotate: '0deg',  z: 3, ac: '#25e0ff' },
                { name: 'Yuki T.', role: 'Japanese, English', rating: 4.8, trips: 31, top: '45%', left: '40%', rotate: '5deg',  z: 2, ac: '#2e63ff' },
              ].map((c) => (
                <div
                  key={c.name}
                  style={{
                    position: 'absolute', top: c.top, left: c.left,
                    transform: `rotate(${c.rotate})`, zIndex: c.z,
                    background: 'rgba(255,255,255,0.04)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '16px',
                    padding: '18px 20px',
                    width: '210px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                    transition: 'transform 0.3s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: `linear-gradient(135deg,${c.ac},rgba(255,255,255,0.1))`, flexShrink: 0 }}/>
                    <div>
                      <p className={it.className} style={{ fontSize: '0.875rem', fontWeight: 600, color: '#eaeefb', margin: 0 }}>{c.name}</p>
                      <p className={it.className} style={{ fontSize: '0.75rem', color: '#818ca9', margin: 0 }}>{c.role}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill={c.ac}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      <span className={it.className} style={{ fontSize: '0.75rem', fontWeight: 600, color: '#eaeefb' }}>{c.rating}</span>
                    </div>
                    <span className={jb.className} style={{ fontSize: '0.7rem', color: '#818ca9' }}>{c.trips} trips</span>
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', background: `${c.ac}18`, border: `1px solid ${c.ac}30`, borderRadius: '100px', padding: '4px 10px', width: 'fit-content' }}>
                    <CheckIcon color={c.ac} />
                    <span className={jb.className} style={{ fontSize: '0.675rem', color: c.ac }}>Verified</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          SAFETY — 6-card grid
      ════════════════════════════════════════════════ */}
      <section id="safety" style={{ position: 'relative', zIndex: 10, padding: '100px 0' }}>
        <div style={{
          position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(37,224,255,0.045) 0%, transparent 55%)',
        }}/>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <div className={`tb-eyebrow ${jb.className}`} style={{ justifyContent: 'center', marginBottom: '16px' }}>Safety</div>
            <h2 className={`${sg.className} tb-section-heading tb-text-chrome`} style={{ margin: 0 }}>
              Because safety should travel with you.
            </h2>
          </div>
          <div
            className="safety-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}
          >
            <style>{`
              @media (max-width: 900px) { .safety-grid { grid-template-columns: repeat(2, 1fr) !important; } }
              @media (max-width: 550px) { .safety-grid { grid-template-columns: 1fr !important; } }
            `}</style>
            {[
              { title: 'Verified Companions', body: 'Every companion passes thorough identity checks before accepting any trip.', color: '#25e0ff', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg> },
              { title: 'KYC Verification', body: 'Government ID and biometric confirmation required for all companions.', color: '#25e0ff', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0"/></svg> },
              { title: 'Emergency Contacts', body: 'Register emergency contacts who receive real-time updates and alerts.', color: '#2e63ff', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg> },
              { title: 'Trip Check-ins', body: 'Scheduled reminders ensure the traveler is safe at key moments during the trip.', color: '#2e63ff', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> },
              { title: 'Location Updates', body: 'Continuous GPS tracking shared live with registered family members.', color: '#25e0ff', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg> },
              { title: 'SOS Support', body: 'One-tap SOS alerts emergency contacts and our dedicated response team simultaneously.', color: '#ff2e88', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg> },
            ].map((card) => (
              <div
                key={card.title}
                className="tb-glass-card"
                style={{ padding: '32px 28px', position: 'relative', overflow: 'hidden' }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg,transparent,${card.color}55,transparent)` }}/>
                <div style={{ width: '44px', height: '44px', borderRadius: '11px', background: `${card.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: card.color, marginBottom: '20px' }}>
                  {card.icon}
                </div>
                <h3 className={sg.className} style={{ fontSize: '1rem', fontWeight: 600, color: '#eaeefb', margin: '0 0 10px' }}>{card.title}</h3>
                <p className={it.className} style={{ fontSize: '0.9rem', lineHeight: 1.65, color: '#818ca9', margin: 0 }}>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          MATCHING ENGINE — product visualization
      ════════════════════════════════════════════════ */}
      <section style={{ position: 'relative', zIndex: 10, padding: '100px 0' }}>
        <div style={{
          position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(46,99,255,0.05) 0%, transparent 60%)',
        }}/>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 className={`${sg.className} tb-section-heading tb-text-chrome`} style={{ margin: 0 }}>
              Not just a match.<br />The right match.
            </h2>
          </div>

          {/* 3-panel visualization */}
          <div
            className="match-grid"
            style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '24px', marginBottom: '40px' }}
          >
            <style>{`@media (max-width: 767px) { .match-grid { grid-template-columns: 1fr !important; } .match-connector { display: none !important; } }`}</style>

            {/* Panel 1: Requirements */}
            <div className="tb-glass-card" style={{ padding: '28px', position: 'relative', overflow: 'hidden', boxShadow: '0 0 40px rgba(37,224,255,0.06)' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg,transparent,rgba(37,224,255,0.55),transparent)' }}/>
              <p className={jb.className} style={{ fontSize: '0.6875rem', letterSpacing: '0.15em', color: '#25e0ff', marginBottom: '20px' }}>TRAVELER REQUIREMENTS</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { label: 'Route',      value: 'Mumbai → Delhi',   color: '#25e0ff' },
                  { label: 'Language',   value: 'Hindi, English',   color: '#2e63ff' },
                  { label: 'Assistance', value: 'Wheelchair support', color: '#ff2e88' },
                  { label: 'Dates',      value: 'Oct 12 – Oct 14',  color: '#25e0ff' },
                ].map((r) => (
                  <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '9px 14px' }}>
                    <span className={it.className} style={{ fontSize: '0.8125rem', color: '#818ca9' }}>{r.label}</span>
                    <span className={it.className} style={{ fontSize: '0.8125rem', fontWeight: 500, color: r.color }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Connector */}
            <div className="match-connector" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div className="tb-pulse-line" style={{ width: '60px', height: '1px', background: 'linear-gradient(90deg,rgba(37,224,255,0.7),transparent)' }}/>
              <div style={{
                background: 'linear-gradient(135deg,rgba(37,224,255,0.1),rgba(46,99,255,0.1))',
                border: '1px solid rgba(37,224,255,0.22)',
                borderRadius: '16px',
                padding: '20px 24px',
                textAlign: 'center',
                boxShadow: '0 0 36px rgba(37,224,255,0.16)',
                minWidth: '140px',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#25e0ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto 10px' }}>
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
                <p className={sg.className} style={{ fontSize: '0.875rem', fontWeight: 600, color: '#eaeefb', margin: '0 0 4px' }}>Matching Engine</p>
                <p className={jb.className} style={{ fontSize: '0.6875rem', color: '#818ca9', margin: 0 }}>6 factors</p>
              </div>
              <div className="tb-pulse-line" style={{ width: '60px', height: '1px', background: 'linear-gradient(90deg,transparent,rgba(255,46,136,0.7))', animationDelay: '0.5s' }}/>
            </div>

            {/* Panel 3: Ranked */}
            <div className="tb-glass-card" style={{ padding: '28px', position: 'relative', overflow: 'hidden', boxShadow: '0 0 40px rgba(255,46,136,0.06)' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg,transparent,rgba(255,46,136,0.55),transparent)' }}/>
              <p className={jb.className} style={{ fontSize: '0.6875rem', letterSpacing: '0.15em', color: '#ff2e88', marginBottom: '20px' }}>RANKED COMPANIONS</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  { name: 'Priya R.', score: 97, color: '#25e0ff' },
                  { name: 'Amrit S.', score: 91, color: '#2e63ff' },
                  { name: 'Meera K.', score: 85, color: '#ff2e88' },
                ].map((c, idx) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={jb.className} style={{ fontSize: '0.75rem', color: '#4b5568', width: '16px', flexShrink: 0 }}>#{idx+1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span className={it.className} style={{ fontSize: '0.875rem', fontWeight: 500, color: '#eaeefb' }}>{c.name}</span>
                        <span className={jb.className} style={{ fontSize: '0.8125rem', color: c.color }}>{c.score}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${c.score}%`, background: `linear-gradient(90deg,${c.color},${c.color}80)`, borderRadius: '3px' }}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Factor pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
            {[
              { label: 'Route',        color: '#25e0ff' },
              { label: 'Language',     color: '#2e63ff' },
              { label: 'Assistance',   color: '#ff2e88' },
              { label: 'Availability', color: '#25e0ff' },
              { label: 'Verification', color: '#2e63ff' },
              { label: 'Experience',   color: '#ff2e88' },
            ].map((f) => (
              <span
                key={f.label}
                className={jb.className}
                style={{
                  fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.08em',
                  padding: '8px 18px', borderRadius: '100px',
                  background: `${f.color}12`, border: `1px solid ${f.color}30`, color: f.color,
                }}
              >
                {f.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          FINAL CTA — cinematic
      ════════════════════════════════════════════════ */}
      <section style={{ position: 'relative', zIndex: 10, padding: '120px 0', overflow: 'hidden' }}>
        {/* Atmospheric base */}
        <div style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 100%, rgba(37,224,255,0.09) 0%, rgba(46,99,255,0.07) 30%, transparent 70%)' }}/>
        <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '700px', height: '200px', background: 'radial-gradient(ellipse, rgba(37,224,255,0.12) 0%, transparent 70%)', filter: 'blur(60px)', pointerEvents: 'none' }}/>
        <div style={{ maxWidth: '860px', margin: '0 auto', padding: '0 32px', textAlign: 'center', position: 'relative' }}>
          <h2
            className={`${sg.className} tb-text-chrome`}
            style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.025em', margin: '0 0 24px' }}
          >
            Every journey deserves<br />a trusted companion.
          </h2>
          <p
            className={it.className}
            style={{ fontSize: '1.0625rem', lineHeight: 1.7, color: '#818ca9', margin: '0 0 44px', maxWidth: '50ch', marginLeft: 'auto', marginRight: 'auto' }}
          >
            Whether you&apos;re planning a journey for someone you love or you&apos;re ready to help someone travel with confidence, TravelBuddy is here.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <a href="/auth/sign-up" className={`tb-btn-primary ${it.className}`} style={{ padding: '13px 30px', fontSize: '0.9375rem' }}>
              Get started&nbsp;<ArrowRight />
              <span className="tb-shimmer" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)', pointerEvents: 'none' }}/>
            </a>
            <a href="/auth/sign-up" className={`tb-btn-secondary ${it.className}`} style={{ padding: '13px 30px', fontSize: '0.9375rem' }}>
              Become a companion
            </a>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════ */}
      <footer style={{ position: 'relative', zIndex: 10, borderTop: '1px solid rgba(255,255,255,0.05)', padding: '48px 0' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>
          <div
            className="footer-grid"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'start', gap: '40px' }}
          >
            <style>{`@media (max-width: 650px) { .footer-grid { grid-template-columns: 1fr !important; gap: 28px !important; } }`}</style>
            {/* Brand */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <span className={sg.className} style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.03em', background: 'linear-gradient(135deg,#fff,#eaeefb)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>TravelBuddy</span>
                <span style={{ color: '#ff2e88', fontWeight: 700, fontSize: '1.375rem' }}>.</span>
              </div>
              <p className={it.className} style={{ fontSize: '0.875rem', color: '#4b5568', margin: 0 }}>Safe journeys. Trusted companions.</p>
            </div>
            {/* Nav */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
              {[
                { label: 'How it works', href: '#how-it-works' },
                { label: 'Families',     href: '#families' },
                { label: 'Companions',   href: '#companions' },
                { label: 'Safety',       href: '#safety' },
                { label: 'Sign in',      href: '/auth/sign-in' },
              ].map(({ label, href }) => (
                <a key={label} href={href} className={`${it.className} tb-nav-link`} style={{ fontSize: '0.875rem' }}>{label}</a>
              ))}
            </div>
            {/* Legal */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
              {[
                { label: 'Privacy', href: '#' },
                { label: 'Terms',   href: '#' },
                { label: 'Contact', href: '#' },
              ].map(({ label, href }) => (
                <a key={label} href={href} className={it.className} style={{ fontSize: '0.8125rem', color: '#4b5568', textDecoration: 'none', transition: 'color 0.2s' }}
                  onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#818ca9')}
                  onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#4b5568')}
                >{label}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
