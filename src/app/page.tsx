import Link from "next/link";
import {
  ArrowRight,
  Database,
  FileSearch,
  Bot,
  ShieldCheck,
  BarChart3,
  Layers,
  GitBranch,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";

const CAPABILITIES = [
  {
    icon: Database,
    title: "Unified data layer",
    body: "We structure data from every system your teams use and digitize what's still on paper — into one layer every AI agent can read, query, and act on.",
  },
  {
    icon: FileSearch,
    title: "Living data room",
    body: "A single, evolving data room where every document, decision, and dataset is connected, searchable, and always current.",
  },
  {
    icon: Bot,
    title: "Agentic workflows",
    body: "Agents execute complex, time-sensitive tasks with deterministic logic — and route to your experts when the decision requires it.",
  },
  {
    icon: BarChart3,
    title: "On-demand analytics",
    body: "Generate real-time analytics across CMC, regulatory, or clinical data. Ask questions and get precise, source-backed answers.",
  },
  {
    icon: ShieldCheck,
    title: "Audit & compliance",
    body: "Every agent action is visible and traceable. Protocol-compliance checks against ICH E6(R3) and 21 CFR Part 11, ready for regulators.",
  },
  {
    icon: Layers,
    title: "Integrates everything",
    body: "Connect LIMS, QMS, ELN, literature, chemistry and toxicity databases. Your knowledge, finally in one place.",
  },
];

const BUILT_FOR = ["Biotech R&D", "CROs", "Research hospitals", "Academic labs"];

export default function Landing() {
  return (
    <div className="flex flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Workflow className="size-4" />
            </div>
            Pharma&nbsp;OS
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#capabilities" className="hover:text-foreground">Platform</a>
            <a href="#workflows" className="hover:text-foreground">Workflows</a>
            <a href="#security" className="hover:text-foreground">Security</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Login</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Book a demo</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.52_0.18_256/0.12),transparent)]" />
        <div className="mx-auto w-full max-w-6xl px-6 py-24 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-[var(--success)]" />
            An AI workspace for drug development teams
          </div>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Your R&amp;D knowledge, finally working for you
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
            Pharma OS unifies your documents, data, and regulatory workflows into one AI-readable
            layer — so your team and intelligent agents can search, analyze, and act on everything
            in one place.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">
                Get started <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#workflows">See workflows</Link>
            </Button>
          </div>
          <div className="mt-16">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Built for teams across
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-70">
              {BUILT_FOR.map((t) => (
                <span key={t} className="text-lg font-semibold tracking-tight">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">One platform, the whole pipeline</h2>
          <p className="mt-3 text-muted-foreground">
            From ingestion to regulatory submission — empower the people bringing life-saving
            medicines to patients.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border bg-card p-6">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <c.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflows */}
      <section id="workflows" className="border-y bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">Pre-built agentic workflows</h2>
            <p className="mt-3 text-muted-foreground">
              Deterministic, multi-step workflows that run with full audit trails and escalate to
              your experts when judgment is required.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_CATALOG.map((w) => (
              <div key={w.key} className="group rounded-xl border bg-card p-5">
                <GitBranch className="size-5 text-primary" />
                <h3 className="mt-3 font-medium">{w.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{w.description}</p>
                <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
                  <span>{w.steps} steps</span>
                  <span>·</span>
                  <span>{w.agents} agents</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Secure by design</h2>
            <p className="mt-3 text-muted-foreground">
              Built for regulated environments. Your data is never used to train our models or
              third-party models.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "SOC 2 Type II, ISO 27001 certified, GDPR compliant",
                "TLS 1.2+ in transit, AES-256 at rest",
                "Tamper-evident, hash-chained audit log of every AI action",
                "Granular roles, multi-tenant isolation, single-tenant deployment",
              ].map((s) => (
                <li key={s} className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                  <span className="text-muted-foreground">{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-10 text-center">
            <h3 className="text-2xl font-semibold">Ready to see it?</h3>
            <p className="mt-2 text-muted-foreground">
              Stand up your data room and run your first agentic workflow in minutes.
            </p>
            <Button size="lg" className="mt-6" asChild>
              <Link href="/signup">
                Book a demo <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} Pharma OS</span>
          <span>An AI workspace for drug development</span>
        </div>
      </footer>
    </div>
  );
}
