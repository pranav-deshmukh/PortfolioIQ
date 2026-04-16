// ── Unified LLM Abstraction ──────────────────────────────────────────
// Supports Google Gemini and OpenRouter (Nemotron).
// Controlled by LLM_PROVIDER env variable ("gemini" | "openrouter").
// Both providers expose the same interface so the rest of the codebase
// doesn't need to know which backend is active.

import dotenv from "dotenv";
dotenv.config();

// ── Provider config ──────────────────────────────────────────────────
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openrouter").toLowerCase();

// OpenRouter (backup)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.5-flash";

export function getProviderName() {
  if (LLM_PROVIDER === "gemini") return `Gemini (${GEMINI_MODEL})`;
  return `OpenRouter (${OPENROUTER_MODEL})`;
}

export function isConfigured() {
  if (LLM_PROVIDER === "gemini") return !!GEMINI_API_KEY;
  return !!OPENROUTER_API_KEY && OPENROUTER_API_KEY !== "your_openrouter_api_key_here";
}

// ═══════════════════════════════════════════════════════════════════════
// FORMAT CONVERTERS — OpenAI ↔ Gemini
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert OpenAI-style messages array → Gemini contents array + system.
 * Gemini uses { role: "user"|"model", parts: [...] } and a separate
 * systemInstruction field for system messages.
 */
function messagesToGemini(messages) {
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Gemini supports a single system instruction; concatenate multiples
      if (!systemInstruction) {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        systemInstruction.parts.push({ text: msg.content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts = [];
      if (msg.content) parts.push({ text: msg.content });
      // Convert tool_calls to Gemini functionCall parts
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args;
          try { args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch { args = {}; }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    if (msg.role === "tool") {
      // Gemini expects functionResponse inside a "user" turn (or inline)
      let parsed;
      try { parsed = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content; } catch { parsed = { result: msg.content }; }
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: msg._toolName || "tool", response: normalizeGeminiFunctionResponse(parsed) } }]
      });
      continue;
    }

    // user message
    contents.push({ role: "user", parts: [{ text: msg.content || "" }] });
  }

  return { systemInstruction, contents };
}

function normalizeGeminiFunctionResponse(value) {
  if (Array.isArray(value)) {
    return { result: value };
  }

  if (value && typeof value === "object") {
    return value;
  }

  return { result: value };
}

/**
 * Convert OpenAI-style tools array → Gemini functionDeclarations.
 */
function toolsToGemini(tools) {
  if (!tools || tools.length === 0) return undefined;
  const declarations = tools.map(t => {
    const fn = t.function;
    const decl = { name: fn.name, description: fn.description };
    if (fn.parameters && Object.keys(fn.parameters).length > 0) {
      decl.parameters = cleanSchemaForGemini(fn.parameters);
    }
    return decl;
  });
  return [{ functionDeclarations: declarations }];
}

/**
 * Strip unsupported JSON Schema keys for Gemini (e.g. "additionalProperties").
 */
function cleanSchemaForGemini(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue; // Gemini doesn't support this
    if (typeof value === "object" && !Array.isArray(value)) {
      cleaned[key] = cleanSchemaForGemini(value);
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map(v => typeof v === "object" ? cleanSchemaForGemini(v) : v);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Parse Gemini response → normalized { content, tool_calls } matching
 * OpenAI shape so the rest of the codebase doesn't change.
 */
function parseGeminiResponse(candidate) {
  const parts = candidate?.content?.parts || [];
  let content = "";
  const tool_calls = [];

  for (const part of parts) {
    if (part.text) content += part.text;
    if (part.functionCall) {
      tool_calls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }
  }

  return {
    content: content || null,
    tool_calls: tool_calls.length > 0 ? tool_calls : null,
    finish_reason: candidate?.finishReason || "stop"
  };
}


// ═══════════════════════════════════════════════════════════════════════
// GEMINI CALLS
// ═══════════════════════════════════════════════════════════════════════

async function geminiCallNonStreaming(messages, tools, { temperature = 0.3, maxTokens = 3000 } = {}) {
  const { systemInstruction, contents } = messagesToGemini(messages);
  const geminiTools = toolsToGemini(tools);

  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (geminiTools) body.tools = geminiTools;

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // Retry on 429 rate limit (free tier can be bursty)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (res.status === 429 && attempt < 3) {
      const wait = attempt * 5;
      console.warn(`[Gemini] Rate limited, retrying in ${wait}s (attempt ${attempt})...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const candidate = json.candidates?.[0];
    if (!candidate) {
      throw new Error("Gemini returned no candidates");
    }

    return parseGeminiResponse(candidate);
  }
}

/**
 * Gemini streaming — uses ?alt=sse endpoint.
 * Returns an async generator that yields { type, content?, tool_calls? }
 */
async function* geminiStreamCall(messages, tools, { temperature = 0.3, maxTokens = 3000 } = {}) {
  const { systemInstruction, contents } = messagesToGemini(messages);
  const geminiTools = toolsToGemini(tools);

  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (geminiTools) body.tools = geminiTools;

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini stream API error ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") continue;

      try {
        const chunk = JSON.parse(payload);
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            yield { type: "token", content: part.text };
          }
          if (part.functionCall) {
            yield {
              type: "tool_call",
              tool_call: {
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: "function",
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args || {})
                }
              }
            };
          }
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════
// OPENROUTER CALLS
// ═══════════════════════════════════════════════════════════════════════

async function openrouterCallNonStreaming(messages, tools, { temperature = 0.3, maxTokens = 3000 } = {}) {
  const body = {
    model: OPENROUTER_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "http://localhost:3001",
      "X-Title": "LPL Advisor Copilot"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) throw new Error("OpenRouter returned no choices");

  return {
    content: choice.message?.content || null,
    tool_calls: choice.message?.tool_calls || null,
    finish_reason: choice.finish_reason || "stop"
  };
}

/**
 * OpenRouter streaming — uses standard OpenAI SSE format.
 * Returns an async generator that yields { type, content?, tool_call? }
 */
async function* openrouterStreamCall(messages, tools, { temperature = 0.3, maxTokens = 3000 } = {}) {
  const body = {
    model: OPENROUTER_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "http://localhost:3001",
      "X-Title": "LPL Advisor Copilot"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter stream API error ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  // For OpenRouter, tool calls arrive in deltas that need accumulating
  let pendingToolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") continue;

      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: "token", content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!pendingToolCalls[idx]) {
              pendingToolCalls[idx] = { id: tc.id || "", type: "function", function: { name: tc.function?.name || "", arguments: "" } };
            }
            if (tc.id) pendingToolCalls[idx].id = tc.id;
            if (tc.function?.name) pendingToolCalls[idx].function.name = tc.function.name;
            if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  // Emit accumulated tool calls at the end
  for (const tc of pendingToolCalls) {
    if (tc && tc.function.name) {
      yield { type: "tool_call", tool_call: tc };
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API — unified interface
// ═══════════════════════════════════════════════════════════════════════

/**
 * Non-streaming LLM call.
 * @param {Array} messages  — OpenAI-format messages
 * @param {Array} tools     — OpenAI-format tool definitions (optional)
 * @param {Object} opts     — { temperature, maxTokens }
 * @returns {{ content: string|null, tool_calls: Array|null, finish_reason: string }}
 */
export async function callLLM(messages, tools = null, opts = {}) {
  if (LLM_PROVIDER === "gemini") {
    return geminiCallNonStreaming(messages, tools, opts);
  }
  return openrouterCallNonStreaming(messages, tools, opts);
}

/**
 * Non-streaming LLM call with retry (for pipeline/agent use).
 * Retries up to `retries` times on failure or empty response.
 */
export async function callLLMWithRetry(messages, tools = null, { retries = 2, ...opts } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await callLLM(messages, tools, opts);
      if (result.content || result.tool_calls) return result;
      console.error(`[LLM] Empty response on attempt ${attempt}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[LLM] Error on attempt ${attempt}:`, err.message);
      if (attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return { content: null, tool_calls: null, finish_reason: "error" };
}

/**
 * Streaming LLM call. Returns an async generator yielding:
 *   { type: "token", content: string }
 *   { type: "tool_call", tool_call: { id, type, function: { name, arguments } } }
 */
export async function* streamLLM(messages, tools = null, opts = {}) {
  if (LLM_PROVIDER === "gemini") {
    yield* geminiStreamCall(messages, tools, opts);
  } else {
    yield* openrouterStreamCall(messages, tools, opts);
  }
}

/**
 * Attach tool-name metadata to tool-role messages (needed for Gemini).
 * Call this when building tool result messages.
 */
export function makeToolResultMessage(toolCallId, toolName, resultContent) {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: typeof resultContent === "string" ? resultContent : JSON.stringify(resultContent),
    _toolName: toolName  // used by Gemini converter
  };
}
