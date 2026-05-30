"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          })
        : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push(params.get("next") ?? "/orgs");
    router.refresh();
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6">
      <Link href="/" className="mb-6 flex items-center gap-2 font-semibold">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Workflow className="size-4" />
        </div>
        Pharma OS
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "signup" ? "Create your account" : "Welcome back"}</CardTitle>
          <CardDescription>
            {mode === "signup"
              ? "Start your biopharma workspace in minutes."
              : "Sign in to your workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Researcher"
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@biotech.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href="/signup" className="text-primary hover:underline">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
