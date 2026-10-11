'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { AuthRole, AuthSession } from './types';

type SessionResponse = {
  session: AuthSession | null;
  mode: 'development' | 'unavailable';
  enabled: boolean;
  configured: boolean;
};

export interface DevelopmentAuthContextValue {
  session: AuthSession | null;
  user: AuthSession['user'] | null;
  isLoaded: boolean;
  isDevelopment: boolean;
  signInAsDevUser: (role: AuthRole) => Promise<AuthSession>;
  signOutDevUser: () => Promise<void>;
}

const DevelopmentAuthContext = createContext<DevelopmentAuthContextValue | null>(null);

export function DevelopmentAuthProvider({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession: AuthSession | null;
}) {
  const [session, setSession] = useState<AuthSession | null>(initialSession);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDevelopment, setIsDevelopment] = useState(initialSession?.isDevelopment === true);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/dev-auth/session', { cache: 'no-store' });
    if (!response.ok) {
      setSession(null);
      setIsDevelopment(false);
      return;
    }

    const data = (await response.json()) as SessionResponse;
    setSession(data.session);
    setIsDevelopment(data.mode === 'development' && data.configured);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setIsLoaded(true));
  }, [refresh]);

  const signInAsDevUser = useCallback(async (role: AuthRole) => {
    const response = await fetch('/api/dev-auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });

    if (!response.ok) {
      throw new Error(`Development authentication is unavailable (${response.status}).`);
    }

    const data = (await response.json()) as SessionResponse;
    if (!data.session) {
      throw new Error('Development authentication did not create a session.');
    }
    setSession(data.session);
    setIsDevelopment(true);
    setIsLoaded(true);
    return data.session;
  }, []);

  const signOutDevUser = useCallback(async () => {
    const response = await fetch('/api/dev-auth/session', { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Development authentication is unavailable (${response.status}).`);
    }
    setSession(null);
    setIsDevelopment(false);
  }, []);

  return (
    <DevelopmentAuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isLoaded,
        isDevelopment,
        signInAsDevUser,
        signOutDevUser,
      }}
    >
      {children}
    </DevelopmentAuthContext.Provider>
  );
}

/** Retired fixture boundary; application callers use the native Supabase adapter. */
export function useDevelopmentAuth(): DevelopmentAuthContextValue {
  const context = useContext(DevelopmentAuthContext);
  if (!context) {
    throw new Error('useDevelopmentAuth must be used inside DevelopmentAuthProvider.');
  }
  return context;
}
