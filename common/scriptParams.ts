/**
 * Extract input parameters from a Playwright TypeScript script so the UI can
 * render the right form fields automatically.
 *
 * It reads the `Params` type the script declares, e.g.
 *
 *     type Params = {
 *       url?: string;
 *       term?: string;
 *       count: number;
 *     };
 *     export default async function run(params: Params) { ... }
 *
 * and returns a structured list:
 *
 *     [
 *       { key: "url",   type: "string", required: false, default: "https://example.com" },
 *       { key: "term",  type: "string", required: false },
 *       { key: "count", type: "number", required: true  },
 *     ]
 *
 * Optional `?` -> not required; a bare `:` -> required. Default values written as
 * `params.url || "..."` (or `??`) are detected and the value is reported.
 *
 * This is intentionally regex/scan based (no TypeScript compiler dependency) and
 * targets the documented contract above; it ignores all other code.
 */
import type { TaskParam } from "./types.js";

export interface ExtractedParam {
  key: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string;
}

// A valid JavaScript identifier (used to reject anything that couldn't be a real key).
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Strip // line comments and /* */ block comments WITHOUT touching string contents,
// so a `//` or `/*` inside a string literal is preserved.
function stripComments(src: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += c2 ?? ""; i++; continue; }   // skip escaped char
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "/" && c2 === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out;
}

// Return the inside of the `type Params = { ... }` / `interface Params { ... }` block.
function extractParamsBlock(src: string): string | null {
  const head = /\b(?:type\s+Params\s*=\s*|interface\s+Params\s*)\{/.exec(src);
  if (!head) return null;
  const braceStart = head.index + head[0].length - 1;     // index of the opening '{'
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(braceStart + 1, i);
  }
  return null;                                              // unbalanced braces
}

// Split a type-literal body into members, respecting nested {}/[]/()/<> so that a
// union or object-typed member isn't split apart. Members may be separated by
// `;`, `,`, or just a newline.
function splitMembers(block: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of block) {
    if ("{[(<".includes(ch)) depth++;
    else if ("}])>".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Map a TypeScript type annotation to one of our three input kinds. Unions drop
// `undefined`/`null`; literal types (e.g. "a" | "b", 1 | 2) infer from their members.
function mapType(tsType: string): "string" | "number" | "boolean" {
  const parts = tsType
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s !== "undefined" && s !== "null");
  if (!parts.length) return "string";
  const kinds = parts.map((p) => {
    if (p === "number" || /^-?\d/.test(p)) return "number";
    if (p === "boolean" || p === "true" || p === "false") return "boolean";
    return "string";                                        // string, string-literal, or anything else
  });
  if (kinds.every((k) => k === "number")) return "number";
  if (kinds.every((k) => k === "boolean")) return "boolean";
  return "string";
}

function unquote(literal: string): string {
  if (/^["'`]/.test(literal)) return literal.slice(1, -1).replace(/\\(.)/g, "$1");
  return literal;
}

// Find a default written as `params.KEY || X`, `params.KEY ?? X`, or the bracket
// form `params["KEY"] || X`. X may be a string/number/boolean literal.
function findDefault(src: string, key: string): string | undefined {
  const lit = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`|-?\\d+(?:\\.\\d+)?|true|false)`;
  const accessors = [`params\\.${key}\\b`, `params\\[\\s*["']${key}["']\\s*\\]`];
  for (const acc of accessors) {
    const m = new RegExp(`${acc}\\s*(?:\\|\\||\\?\\?)\\s*${lit}`).exec(src);
    if (m) {
      const value = unquote(m[1]);
      // `params.x || ""` is a coalesce-to-empty idiom, not a meaningful default.
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

/** Parse a script's `Params` type into a structured, UI-renderable field list. */
export function extractScriptParams(source: string): ExtractedParam[] {
  const src = stripComments(source);
  const block = extractParamsBlock(src);
  if (!block) return [];

  const seen = new Set<string>();
  const result: ExtractedParam[] = [];
  for (const member of splitMembers(block)) {
    // key, optional `?`, then `: type`
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*(\?)?\s*:\s*([\s\S]+)$/.exec(member);
    if (!m) continue;
    const key = m[1];
    if (!IDENT.test(key) || seen.has(key)) continue;        // valid identifiers only, no dupes
    seen.add(key);
    const field: ExtractedParam = {
      key,
      type: mapType(m[3].trim()),
      required: !m[2],
    };
    const def = findDefault(src, key);
    if (def !== undefined) field.default = def;
    result.push(field);
  }
  return result;
}

/** Map extracted params onto the app's TaskParam model used by the Run/Schedule UI. */
export function toTaskParams(params: ExtractedParam[]): TaskParam[] {
  return params.map((p) => {
    // url input hint: keys containing url/uri/href, or named exactly link/site/website/page.
    const looksUrl = /url|uri|href/i.test(p.key) || /^(link|links|site|website|webpage|page)$/i.test(p.key);
    const field: TaskParam = {
      name: p.key,
      label: p.key,
      type: p.type === "number" ? "number" : looksUrl ? "url" : "text",
      required: p.required,
    };
    if (p.default !== undefined) field.default = p.default;
    return field;
  });
}