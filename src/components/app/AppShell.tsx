'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import SignOutButton from '@/components/auth/SignOutButton';
import type { AuthUser } from '@/lib/auth/types';
import { authDestination } from '@/lib/auth/provider';
import { Avatar, Icon, Modal, StatusBadge, cx } from './ui';

const heading = Space_Grotesk({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--tb-heading-font' });
const body = Inter({ subsets: ['latin'], weight: ['400','500','600'], variable: '--tb-body-font' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], variable: '--tb-mono-font' });
type NavItem = { label: string; href: string; icon: string; exact?: boolean };

function navigation(role: AuthUser['role']): NavItem[] {
  if (role === 'family') return [
    { label: 'Overview', href: '/dashboard/family', icon: 'home', exact: true },
    { label: 'Travelers', href: '/dashboard/family/travelers', icon: 'users' },
    { label: 'Trip requests', href: '/dashboard/family/trip-requests', icon: 'plane' },
    { label: 'Companions', href: '/dashboard/family/companions', icon: 'shield' },
    { label: 'Family profile', href: '/dashboard/family/edit', icon: 'user', exact: true },
  ];
  if (role === 'companion') return [
    { label: 'Overview', href: '/dashboard/companions', icon: 'home', exact: true },
    { label: 'Profile & verification', href: '/dashboard/companions#companion-profile', icon: 'shield' },
    { label: 'Availability', href: '/dashboard/companions#availability-summary-heading', icon: 'calendar' },
    { label: 'Assigned journeys', href: '/dashboard/companions#assigned-journeys', icon: 'plane' },
  ];
  return [
    { label: 'Overview', href: '/dashboard/admin', icon: 'home', exact: true },
    { label: 'Verification queue', href: '/dashboard/admin#verification-heading', icon: 'shield' },
    { label: 'People', href: '/dashboard/admin#admin-people', icon: 'users' },
    { label: 'Journeys', href: '/dashboard/admin#admin-journeys', icon: 'plane' },
    { label: 'Safety & feedback', href: '/dashboard/admin#admin-safety', icon: 'heart' },
    { label: 'Audit overview', href: '/dashboard/admin#admin-audit', icon: 'document' },
  ];
}

function pageLabel(pathname: string, role: AuthUser['role']) {
  if (pathname.startsWith('/dashboard/bookings')) return 'Journey workspace';
  if (pathname.endsWith('/matches')) return 'Companion matches';
  if (pathname.endsWith('/new') || pathname.endsWith('/create')) return 'Create a profile or journey';
  if (pathname.includes('/travelers')) return pathname.endsWith('/edit') ? 'Edit traveler' : 'Your travelers';
  if (pathname.includes('/trip-requests')) return 'Trip requests';
  if (role === 'admin') return 'Operations overview';
  if (role === 'companion') return pathname.endsWith('/edit') ? 'Profile & availability' : 'Companion workspace';
  if (pathname.endsWith('/companions')) return 'Discover companions';
  if (pathname.endsWith('/edit')) return 'Family profile';
  return 'Family overview';
}

export function AppHeader({ user, currentPage, onMenu }: { user: AuthUser; currentPage: string; onMenu: () => void }) {
  return <header className="tb-app-header">
    <a href={authDestination(user.role)} className="tb-app-brand" aria-label="TravelBuddy dashboard"><span className="tb-brand-mark"><Icon name="plane" size={19} /></span><span>TravelBuddy<span className="tb-brand-dot">.</span></span></a>
    <div className="tb-header-context"><span className="tb-header-divider" /><span>{currentPage}</span></div>
    <div className="tb-header-account"><div className="tb-account-identity"><Avatar name={user.firstName || user.email} size="small" /><div className="tb-min-zero"><p>{user.firstName || user.email}</p><span>{user.role} account</span></div></div><SignOutButton /><button type="button" className="tb-icon-button tb-menu-toggle" aria-label="Open navigation menu" aria-haspopup="dialog" onClick={onMenu}><Icon name="menu" /></button></div>
  </header>;
}

export function Sidebar({ items, pathname, onNavigate, mobile = false }: { items: NavItem[]; pathname: string; onNavigate?: () => void; mobile?: boolean }) {
  return <nav className={cx('tb-sidebar-nav', mobile && 'tb-sidebar-nav-mobile')} aria-label={mobile ? 'Mobile workspace navigation' : 'Workspace navigation'}><p className="tb-nav-caption">Your workspace</p>{items.map(item => {
    const active = !item.href.includes('#') && (item.exact ? item.href === pathname : pathname === item.href || pathname.startsWith(`${item.href}/`));
    return <a key={item.href} href={item.href} className={cx('tb-app-nav-item', active && 'tb-app-nav-active')} aria-current={active ? 'page' : undefined} onClick={onNavigate}><Icon name={item.icon} size={18} /><span>{item.label}</span>{active && <span className="tb-active-marker" aria-hidden="true" />}</a>;
  })}</nav>;
}

export function AppShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  const nav = navigation(user.role);
  return <div className={cx('tb-app-system tb-app-shell', heading.variable, body.variable, mono.variable)}>
    <a className="tb-skip-link" href="#workspace-content">Skip to main content</a>
    <AppHeader user={user} currentPage={pageLabel(pathname, user.role)} onMenu={() => setMenuOpen(true)} />
    <aside className="tb-sidebar"><Sidebar items={nav} pathname={pathname} /><div className="tb-sidebar-note"><Icon name="shield" size={23} /><p>Thoughtful journeys.<br />Connected care.</p><span>Keep the people who matter at the centre of every plan.</span></div><div className="tb-sidebar-role"><StatusBadge tone="info">{user.role} workspace</StatusBadge></div></aside>
    <div className="tb-app-main" id="workspace-content" tabIndex={-1}><div className="tb-app-content">{children}</div><footer className="tb-app-footer"><span>TravelBuddy · Built for peace of mind</span><span>Safe journeys. Trusted companions.</span></footer></div>
    <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Your TravelBuddy workspace"><div className="tb-mobile-account"><Avatar name={user.firstName || user.email} /><div className="tb-min-zero"><p>{user.email}</p><span className="tb-muted tb-small">{user.role} account</span></div></div><Sidebar items={nav} pathname={pathname} mobile onNavigate={() => setMenuOpen(false)} /></Modal>
  </div>;
}
