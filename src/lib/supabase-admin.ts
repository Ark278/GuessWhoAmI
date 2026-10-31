import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

function getEnv(key: string): string {
  return (process.env[key] || "").trim();
}

/**
 * Returns true if Supabase URL is configured.
 * In production, throws an explicit configuration error if missing or invalid.
 */
export function isSupabaseAdminConfigured(): boolean {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const secretKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    getEnv("SUPABASE_SECRET_KEY") ||
    getEnv("SB_SECRET");

  if (process.env.NODE_ENV === "production") {
    if (!url || !url.startsWith("https://")) {
      throw new Error(
        "CRITICAL: Production deployment requires a valid NEXT_PUBLIC_SUPABASE_URL. In-memory storage fallback is disabled in production."
      );
    }
    if (!secretKey) {
      throw new Error(
        "CRITICAL: Production deployment requires SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY. In-memory storage fallback is disabled in production."
      );
    }
    return true;
  }

  return Boolean(url && url.startsWith("https://"));
}

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Privileged admin client for authoritative server-side database operations.
 * Exclusively uses SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.
 * Never falls back to publishable or anon keys.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const secretKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    getEnv("SUPABASE_SECRET_KEY") ||
    getEnv("SB_SECRET");

  // In production, require full Supabase credentials; never silently fall back
  if (process.env.NODE_ENV === "production") {
    if (!url || !url.startsWith("https://")) {
      throw new Error(
        "CRITICAL: Production deployment requires a valid NEXT_PUBLIC_SUPABASE_URL. In-memory storage fallback is disabled in production."
      );
    }
    if (!secretKey) {
      throw new Error(
        "CRITICAL: Production deployment requires SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY. In-memory storage fallback is disabled in production."
      );
    }
  }

  // In local test/development mode, allow in-memory fallback when Supabase URL is not set
  if (!url) {
    return null;
  }

  if (!secretKey) {
    throw new Error(
      "Supabase configuration error: Server admin operations require SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY. Falling back to the public/anon key is forbidden."
    );
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(url, secretKey, {
      auth: { persistSession: false },
    });
  }

  return cachedAdminClient;
}

export const supabaseAdmin = (() => {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
})();
