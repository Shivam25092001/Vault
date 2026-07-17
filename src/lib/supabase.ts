import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Both values are public-safe by design (HLD §8): they ship in the client
 * bundle. The write gate is the storage INSERT policy, not the key. We surface
 * a clear error rather than letting the SDK fail cryptically on undefined.
 */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const BUCKET = 'vaults';

/** Public URL of an object — no auth, works for recipients (HLD §4). */
export function publicUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
