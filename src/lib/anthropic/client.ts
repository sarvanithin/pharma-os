import { z } from "zod";

/**
 * LLM access via the Martian router (OpenAI-compatible API) routing to Claude.
 * Kept behind these helpers so the rest of the app stays provider-agnostic.
 */
const BASE_URL = "https://api.withmartian.com/v1";

export const MODELS = {
  opus: "anthropic/claude-opus-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",
  haiku: "anthropic/claude-haiku-4-5",
} as const;

export type ModelKey = keyof typeof MODELS;

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

interface ChatChoice {
  message: { content: string | null; tool_calls?: ToolCall[] };
  finish_reason: string;
}
interface ChatResponse {
  choices: ChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function apiKey() {
  const k = process.env.MARTIAN_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("MARTIAN_API_KEY is not set");
  return k;
}

export async function chat(opts: {
  model?: ModelKey;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
}): Promise<{ message: ChatChoice["message"]; usage: UsageStats; finishReason: string }> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS[opts.model ?? "sonnet"],
      messages: opts.messages,
      tools: opts.tools,
      tool_choice: opts.toolChoice,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as ChatResponse;
  const choice = json.choices[0];
  return {
    message: choice.message,
    finishReason: choice.finish_reason,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

/** Force a structured result matching a Zod schema via function calling. */
export async function generateStructured<T extends z.ZodTypeAny>(opts: {
  model?: ModelKey;
  system: string;
  prompt: string;
  schema: T;
  toolName?: string;
  toolDescription?: string;
  maxTokens?: number;
}): Promise<{ data: z.infer<T>; usage: UsageStats }> {
  const name = opts.toolName ?? "submit";
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" }) as Record<string, unknown>;
  const { message, usage } = await chat({
    model: opts.model ?? "opus",
    maxTokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    tools: [{ type: "function", function: { name, description: opts.toolDescription, parameters: jsonSchema } }],
    toolChoice: { type: "function", function: { name } },
  });
  const args = message.tool_calls?.[0]?.function.arguments;
  if (!args) throw new Error("Model did not return a tool call");
  const parsed = opts.schema.safeParse(JSON.parse(args));
  if (!parsed.success) {
    throw new Error("Structured output failed validation: " + JSON.stringify(parsed.error.issues));
  }
  return { data: parsed.data, usage };
}

/** Like generateStructured but with a raw JSON Schema (for dynamic extraction schemas). */
export async function generateJsonSchema(opts: {
  model?: ModelKey;
  system: string;
  prompt: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<{ data: unknown; usage: UsageStats }> {
  const { message, usage } = await chat({
    model: opts.model ?? "opus",
    maxTokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    tools: [{ type: "function", function: { name: opts.name, description: opts.description, parameters: opts.inputSchema } }],
    toolChoice: { type: "function", function: { name: opts.name } },
  });
  const args = message.tool_calls?.[0]?.function.arguments;
  if (!args) throw new Error("Model did not return a tool call");
  return { data: JSON.parse(args), usage };
}

export async function generateText(opts: {
  model?: ModelKey;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ text: string; usage: UsageStats }> {
  const { message, usage } = await chat({
    model: opts.model ?? "sonnet",
    maxTokens: opts.maxTokens ?? 2048,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
  });
  return { text: message.content ?? "", usage };
}

/** Stream a completion, invoking onDelta for each text chunk. Returns full text. */
export async function streamChat(
  opts: { model?: ModelKey; system: string; prompt: string; maxTokens?: number },
  onDelta: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS[opts.model ?? "sonnet"],
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      max_tokens: opts.maxTokens ?? 1500,
      temperature: 0.2,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as { choices: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // partial JSON across chunks — ignore; next read completes it
      }
    }
  }
  return full;
}
