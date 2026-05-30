import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client that BYPASSES RLS. Only use in trusted server contexts
 * (Inngest functions, background jobs, webhooks) — never expose to the client and
 * always scope queries by org_id manually since RLS will not protect you here.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
