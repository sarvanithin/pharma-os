import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Optional keys: empty strings in .env are treated as "unset".
  MARTIAN_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  LLAMA_CLOUD_API_KEY: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

function format(error: z.ZodError) {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

const isServer = typeof window === "undefined";

let parsed: z.infer<typeof serverSchema>;

if (isServer) {
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    // Surface a clear message instead of a cryptic undefined crash deep in a client.
    console.error("Invalid environment variables:\n" + format(result.error));
    throw new Error("Invalid or missing environment variables. See .env.example.");
  }
  parsed = result.data;
} else {
  const result = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!result.success) {
    throw new Error("Invalid public environment variables.");
  }
  parsed = result.data as z.infer<typeof serverSchema>;
}

export const env = parsed;

// LLM is available via Martian (preferred) or a native Anthropic key.
export const hasAnthropic = () =>
  Boolean(process.env.MARTIAN_API_KEY || process.env.ANTHROPIC_API_KEY);
export const hasVoyage = () => Boolean(process.env.VOYAGE_API_KEY);
export const hasOcr = () => Boolean(process.env.LLAMA_CLOUD_API_KEY);
