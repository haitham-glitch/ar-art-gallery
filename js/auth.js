import { supabase } from './supabase-client.js';

/* ---------- Auth actions ---------- */

export async function signUp({ email, password, role, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { role, display_name: displayName }  // → goes to raw_user_meta_data → trigger
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/* ---------- Session / Profile ---------- */

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Profile fetch error:', error);
    return null;
  }
  return data;
}

/* ---------- Route guards ----------
   Use on protected pages. Redirects on failure.
   Returns { user, profile } if access is granted.
------------------------------------------------- */

export async function requireRole(requiredRole, {
  loginUrl = 'login.html',
  homeUrl  = 'index.html'
} = {}) {
  const session = await getSession();
  if (!session) {
    window.location.replace(loginUrl);
    return null;
  }
  const profile = await getProfile(session.user.id);
  if (!profile || profile.role !== requiredRole) {
    window.location.replace(homeUrl);
    return null;
  }
  return { user: session.user, profile };
}