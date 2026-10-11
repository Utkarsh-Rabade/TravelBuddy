/**
 * Application auth boundary.
 *
 * Provider-neutral identity. No role means onboarding is still required.
 */
export type AuthRole = 'family' | 'companion' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AuthRole | null;
}

export interface AuthSession {
  user: AuthUser;
  isDevelopment: boolean;
}

export interface AuthProviderContract {
  getSession(): Promise<AuthSession | null>;
}
