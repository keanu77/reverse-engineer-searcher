/**
 * Helpers for reading LLM completions defensively.
 */

/** Visible text of a chat completion; empty or length-truncated replies are errors. */
export function completionText(response) {
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("模型輸出被截斷（達到長度上限）");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型沒有回傳內容");
  return content.trim();
}

/** Parse the first balanced {...} object in the text (string-aware). */
export function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("回覆中沒有 JSON");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("JSON 不完整");
}

const ROLE_ALIASES = {
  p: "P", population: "P", patient: "P", patients: "P", problem: "P",
  i: "I", intervention: "I", exposure: "I", "intervention/exposure": "I",
  o: "O", outcome: "O", outcomes: "O",
  d: "D", design: "D", "study design": "D",
  other: "Other",
};

/** Map a model-supplied PICO role to P/I/O/D/Other, or null when unknown. */
export function normaliseRole(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/\s*\(.*\)$/, "");
  return ROLE_ALIASES[key] || null;
}

/** Comparison key for terms: case, quotes and whitespace do not matter. */
export function normaliseTermKey(term) {
  return String(term ?? "").toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}
