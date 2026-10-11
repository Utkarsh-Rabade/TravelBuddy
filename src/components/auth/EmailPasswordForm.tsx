'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { authDestination, useAppAuth } from '@/lib/auth/provider';

export default function EmailPasswordForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const signingUp = mode === 'sign-up';
  const { user, isLoaded, error: sessionError, refresh } = useAppAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirmation?: string }>({});

  useEffect(() => {
    if (isLoaded && user && !busy && !redirecting) window.location.replace(authDestination(user.role));
  }, [isLoaded, user, busy, redirecting]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error')) setError('The confirmation link is invalid or has expired. Please sign up again or sign in if your email is already confirmed.');
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || redirecting) return;
    setError(null);
    setSuccess(null);
    const normalizedEmail = email.trim();
    const invalid: typeof fieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) invalid.email = 'Enter a valid email address.';
    if (signingUp && password.length < 8) invalid.password = 'Use a password with at least 8 characters.';
    if (!signingUp && !password) invalid.password = 'Enter your password.';
    if (signingUp && password !== confirmation) invalid.confirmation = 'Passwords do not match.';
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) return;

    setBusy(true);
    try {
      const { data, error: authError } = signingUp
        ? await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        })
        : await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (authError) {
        setError(authError.message);
        return;
      }
      if (signingUp && data.user?.identities?.length === 0) {
        setError('An account with this email already exists. Please sign in instead.');
        return;
      }
      setPassword('');
      setConfirmation('');
      if (signingUp && !data.session) {
        setSuccess('Check your inbox for a confirmation email. Confirm your email before signing in. You can also check your spam folder.');
        return;
      }
      if (!data.session) {
        setError('Unable to start your session. Please try signing in again.');
        return;
      }
      // Only this navigation owns the successful submit; the already-signed-in
      // effect must not concurrently replace /select-role with a second URL.
      setRedirecting(true);
      await refresh();
      // A full navigation reads the new cookies and discards prefetched auth state.
      window.location.replace('/select-role');
    } catch {
      setRedirecting(false);
      setError('Unable to complete sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'mt-2 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-60';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07080d] px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl sm:p-8" aria-labelledby="auth-heading">
        <Link href="/" className="font-semibold text-cyan-300">TravelBuddy</Link>
        <h1 id="auth-heading" className="mt-6 text-2xl font-bold text-white">{signingUp ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-2 text-sm text-slate-300">{signingUp ? 'Sign up with your email to get started.' : 'Sign in with your email and password.'}</p>
        {sessionError && <div className="mt-4 rounded-lg bg-amber-950 p-3 text-sm text-amber-200"><p role="alert">{sessionError}</p><button type="button" onClick={() => void refresh().catch(() => undefined)} className="mt-2 underline">Retry session check</button></div>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        {success && <p role="status" className="mt-4 rounded-lg bg-emerald-950 p-3 text-sm text-emerald-200">{success}</p>}
        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5" aria-busy={busy}>
          <div>
            <label htmlFor="auth-email" className="text-sm font-medium text-slate-200">Email address</label>
            <input id="auth-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'email-error' : undefined} className={inputClass} />
            {fieldErrors.email && <p id="email-error" role="alert" className="mt-2 text-sm text-red-300">{fieldErrors.email}</p>}
          </div>
          <div>
            <label htmlFor="auth-password" className="text-sm font-medium text-slate-200">Password</label>
            <input id="auth-password" name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required minLength={signingUp ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || redirecting} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'} className={inputClass} />
            <p id="password-hint" className="mt-2 text-xs text-slate-400">{signingUp ? 'At least 8 characters.' : 'Enter your account password.'}</p>
            {fieldErrors.password && <p id="password-error" role="alert" className="mt-2 text-sm text-red-300">{fieldErrors.password}</p>}
          </div>
          {signingUp && <div>
            <label htmlFor="auth-confirmation" className="text-sm font-medium text-slate-200">Confirm password</label>
            <input id="auth-confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} aria-invalid={Boolean(fieldErrors.confirmation)} aria-describedby={fieldErrors.confirmation ? 'confirmation-error' : undefined} className={inputClass} />
            {fieldErrors.confirmation && <p id="confirmation-error" role="alert" className="mt-2 text-sm text-red-300">{fieldErrors.confirmation}</p>}
          </div>}
          <button type="submit" disabled={busy || redirecting} className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">{busy || redirecting ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className="mt-6 text-sm text-slate-300">{signingUp ? 'Already have an account? ' : 'New to TravelBuddy? '}<Link href={signingUp ? '/auth/sign-in' : '/auth/sign-up'} className="font-medium text-cyan-300 underline">{signingUp ? 'Sign in' : 'Create an account'}</Link></p>
      </section>
    </main>
  );
}
