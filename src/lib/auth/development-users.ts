import type { AuthRole, AuthUser } from './types';

/** Stable, synthetic identities used only by the local development provider. */
export const DEV_FAMILY_USER: AuthUser = Object.freeze({
  id: 'dev-family-user',
  email: 'family@example.invalid',
  firstName: 'Dev',
  lastName: 'Family',
  role: 'family',
});

export const DEV_COMPANION_USER: AuthUser = Object.freeze({
  id: 'dev-companion-user',
  email: 'companion@example.invalid',
  firstName: 'Dev',
  lastName: 'Companion',
  role: 'companion',
});

/** Stable local admin identity; database admin_roles remains authoritative. */
export const DEV_ADMIN_USER: AuthUser = Object.freeze({
  id: 'dev-admin-user',
  email: 'admin@example.invalid',
  firstName: 'Dev',
  lastName: 'Admin',
  role: 'admin',
});

export const DEVELOPMENT_USERS: Readonly<Record<AuthRole, AuthUser>> = Object.freeze({
  family: DEV_FAMILY_USER,
  companion: DEV_COMPANION_USER,
  admin: DEV_ADMIN_USER,
});

export function isAuthRole(value: unknown): value is AuthRole {
  return value === 'family' || value === 'companion' || value === 'admin';
}

export function getDevelopmentUser(role: AuthRole): AuthUser {
  return DEVELOPMENT_USERS[role];
}
