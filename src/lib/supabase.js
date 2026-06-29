import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Falla temprano y claro si falta la config (revisar .env).
  console.error("Falta VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en .env");
}

export const supabase = createClient(url, key);

// Garantiza una sesión: si no hay, inicia sesión anónima. Devuelve el user.
// Además fija el token en el socket de Realtime para que apliquen las políticas
// `to authenticated`/RLS y se entreguen los postgres_changes.
export async function ensureAuth() {
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }

  if (session?.access_token) {
    try {
      supabase.realtime.setAuth(session.access_token);
    } catch {
      /* no crítico */
    }
  }
  return session.user;
}

// Mantener el socket de Realtime con el token vigente si cambia la sesión.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    try {
      supabase.realtime.setAuth(session.access_token);
    } catch {
      /* no crítico */
    }
  }
});
