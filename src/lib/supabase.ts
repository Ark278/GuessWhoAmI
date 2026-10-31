import { createClient, SupabaseClient } from "@supabase/supabase-js";

function getEnv(key: string): string {
  return (process.env[key] || "").trim();
}

export function getSupabaseConfig() {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const anonKey =
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    getEnv("SUPABASE_ANON_KEY");
  const serviceKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    getEnv("SUPABASE_SECRET_KEY") ||
    getEnv("SB_SECRET");

  const isConfigured = Boolean(url && url.startsWith("https://") && (anonKey || serviceKey));
  const hasServiceRole = Boolean(serviceKey);

  return { url, anonKey, serviceKey, isConfigured, hasServiceRole };
}

export const isSupabaseConfigured = getSupabaseConfig().isConfigured;

// Public client for browser / Realtime subscriptions
export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !anonKey) return null;
  return createClient(url, anonKey);
}

// Server-side admin client for authoritative database operations
export function getSupabaseAdmin(): SupabaseClient | null {
  const { url, anonKey, serviceKey, isConfigured, hasServiceRole } = getSupabaseConfig();
  if (!isConfigured) return null;

  const keyToUse = serviceKey || anonKey;
  if (!hasServiceRole && process.env.NODE_ENV === "production") {
    console.warn(
      "[Supabase Config Warning] SUPABASE_SERVICE_ROLE_KEY is not set. Backend operations are falling back to anon key and may fail RLS policies."
    );
  }

  return createClient(url, keyToUse, {
    auth: { persistSession: false },
  });
}

export const supabase = getSupabaseClient();
export const supabaseAdmin = getSupabaseAdmin();
