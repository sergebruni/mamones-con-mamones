import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Falla temprano y claro si falta la config (revisar .env).
  console.error("Falta VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en .env");
}

export const supabase = createClient(url, key);

// Garantiza una sesión: si no hay, inicia sesión anónima. Devuelve el user.
export async function ensureAuth() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}
