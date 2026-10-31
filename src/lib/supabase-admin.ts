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

function classifyKeyType(key: string): string {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "sb_secret (modern opaque secret key)";
  if (key.startsWith("sb_publishable_")) return "sb_publishable (MISCONFIGURED: public key in secret slot)";
  if (key.startsWith("eyJ")) return "jwt (legacy service_role JWT)";
  return "custom_or_unrecognized";
}

function createDiagnosticFetch(secretKey: string) {
  const isSbSecret = secretKey.startsWith("sb_secret_");
  const keyType = classifyKeyType(secretKey);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let sanitizedPath = "";
    try {
      sanitizedPath = new URL(rawUrl).pathname;
    } catch {
      sanitizedPath = "unknown-path";
    }

    const method = init?.method || "GET";
    const reqHeaders = new Headers(init?.headers);

    // In @supabase/supabase-js v2.118.0, fetchWithAuth inadvertently attaches
    // 'Authorization: Bearer sb_secret_...' to PostgREST requests because omitApiKeyAsBearer
    // is only passed to functionsFetch. Kong/PostgREST rejects non-JWT Bearer tokens with HTTP 401.
    // If an sb_secret_ key is attached as a Bearer token, remove it so only 'apikey' is sent.
    const authHeader = reqHeaders.get("authorization");
    const hadSbSecretBearer = Boolean(
      isSbSecret && authHeader && authHeader.toLowerCase().startsWith("bearer sb_secret_")
    );

    if (hadSbSecretBearer) {
      reqHeaders.delete("authorization");
    }

    const modifiedInit = {
      ...init,
      headers: reqHeaders,
    };

    let res: Response;
    try {
      res = await fetch(input, modifiedInit);
    } catch (netErr: any) {
      console.error("[Supabase Admin Fetch Network Failure]:", {
        path: sanitizedPath,
        method,
        keyType,
        errorName: netErr?.name,
        errorMessage: netErr?.message,
      });
      throw netErr;
    }

    if (!res.ok) {
      let bodyText = "";
      try {
        const clone = res.clone();
        bodyText = await clone.text();
      } catch {
        bodyText = "<failed to read response body>";
      }

      console.error("[Supabase Admin Request Failed]:", {
        path: sanitizedPath,
        method,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get("content-type"),
        responseBody: bodyText,
        keyType,
        hadSbSecretBearerStripped: hadSbSecretBearer,
      });
    }

    return res;
  };
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
    const keyType = classifyKeyType(secretKey);
    console.log("[Supabase Admin Config]:", {
      urlHostname: new URL(url).hostname,
      keyType,
      keyLength: secretKey.length,
      keySource: getEnv("SUPABASE_SERVICE_ROLE_KEY")
        ? "SUPABASE_SERVICE_ROLE_KEY"
        : getEnv("SUPABASE_SECRET_KEY")
        ? "SUPABASE_SECRET_KEY"
        : "SB_SECRET",
    });

    cachedAdminClient = createClient(url, secretKey, {
      auth: { persistSession: false },
      global: {
        fetch: createDiagnosticFetch(secretKey),
      },
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
