import { createClient, SupabaseClient } from "@supabase/supabase-js";

function getEnv(key: string): string {
  return (process.env[key] || "").trim();
}

const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey =
  getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
  getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

export const isSupabaseConfigured = Boolean(
  url && anonKey && url.startsWith("https://")
);

let cachedPublicClient: SupabaseClient | null = null;

/**
 * Public client for browser usage and Realtime subscriptions.
 * Uses only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;

  if (!cachedPublicClient) {
    cachedPublicClient = createClient(url, anonKey);
  }

  return cachedPublicClient;
}

export const supabase = getSupabaseClient();
