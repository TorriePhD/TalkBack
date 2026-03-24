import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from './supabase';

export interface AppProfile {
  id: string;
  email: string;
  createdAt: string;
}

interface AuthCredentials {
  email: string;
  password: string;
}

interface SignUpResult {
  session: Session | null;
  requiresEmailConfirmation: boolean;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function buildEmailRedirectUrl() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

export async function getSession() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new Error(`Unable to read the current session: ${error.message}`);
  }

  return data.session;
}

export function subscribeToAuthChanges(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  const client = requireSupabase();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange(callback);

  return subscription;
}

export async function signUpWithEmail(
  credentials: AuthCredentials,
): Promise<SignUpResult> {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email: normalizeEmail(credentials.email),
    password: credentials.password,
    options: {
      emailRedirectTo: buildEmailRedirectUrl(),
    },
  });

  if (error) {
    throw new Error(`Unable to create the account: ${error.message}`);
  }

  return {
    session: data.session,
    requiresEmailConfirmation: Boolean(data.user) && !data.session,
  };
}

export async function signInWithEmail(credentials: AuthCredentials) {
  const client = requireSupabase();
  const { error } = await client.auth.signInWithPassword({
    email: normalizeEmail(credentials.email),
    password: credentials.password,
  });

  if (error) {
    throw new Error(`Unable to log in: ${error.message}`);
  }
}

export async function signOut() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();

  if (error) {
    throw new Error(`Unable to sign out: ${error.message}`);
  }
}

export async function getMyProfile(): Promise<AppProfile> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('id, email, created_at')
    .single();

  if (error || !data) {
    throw new Error(`Unable to load your profile: ${error?.message || 'Unknown error.'}`);
  }

  return {
    id: data.id,
    email: data.email,
    createdAt: data.created_at,
  };
}
