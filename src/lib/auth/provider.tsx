'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AuthSession, AuthUser } from './types';

interface AppAuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  isLoaded: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

const AppAuthContext = createContext<AppAuthContextValue | null>(null);

export function authDestination(role: AuthUser['role']): string {
  if (role === 'family') return '/dashboard/family';
  if (role === 'companion') return '/dashboard/companions';
  if (role === 'admin') return '/dashboard/admin';
  return '/select-role';
}

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const currentRevision = ++revision.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Unable to verify your session. Please try again.');
      const data: { user: AuthUser | null } = await response.json();
      if (!data || !Object.prototype.hasOwnProperty.call(data, 'user')) {
        throw new Error('Unable to verify your session. Please try again.');
      }
      if (data.user !== null && (
        !data.user || typeof data.user.id !== 'string' || typeof data.user.email !== 'string' ||
        typeof data.user.firstName !== 'string' || typeof data.user.lastName !== 'string' ||
        ![null, 'family', 'companion', 'admin'].includes(data.user.role)
      )) throw new Error('Unable to verify your session. Please try again.');
      if (mounted.current && currentRevision === revision.current) {
        setUser(data.user);
        setError(null);
      }
    } catch {
      if (mounted.current && currentRevision === revision.current) {
        // Fail closed: never keep a previously verified user after verification fails.
        setUser(null);
        setError('Unable to verify your session. Check your connection and try again.');
        throw new Error('Unable to verify your session. Check your connection and try again.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && currentRevision === revision.current) setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let scheduled: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(scheduled);
      // Supabase holds its auth lock in the callback; refresh on a later task.
      scheduled = window.setTimeout(() => void refresh().catch(() => undefined), 0);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      ++revision.current;
      request.current?.abort();
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setError(null);
        setIsLoaded(true);
      } else {
        setIsLoaded(false);
      }
      scheduleRefresh();
    });
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsLoaded(false);
        scheduleRefresh();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
      ++revision.current;
      request.current?.abort();
      window.clearTimeout(scheduled);
      subscription.unsubscribe();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refresh]);

  const value = useMemo<AppAuthContextValue>(() => ({
    user,
    session: user ? { user, isDevelopment: false } : null,
    isLoaded,
    error,
    refresh,
  }), [user, isLoaded, error, refresh]);

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

export function useAppAuth(): AppAuthContextValue {
  const context = useContext(AppAuthContext);
  if (!context) throw new Error('useAppAuth must be used inside AppAuthProvider.');
  return context;
}
