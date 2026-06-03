/**
 * Recursive snake_case ↔ camelCase converters used at the REST request/response
 * boundary in HttpClient. The macOS app uses Swift's
 * `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase` (and the encoder
 * variant) to translate server payloads to the camelCase shape its Codable
 * structs expect. The TS port needs the same translation explicitly.
 *
 * These utilities are pure data transforms — no zod, no schema dependency —
 * so they can be applied as preprocessing before any schema parse and after
 * any schema-produced request body.
 */

/** Convert one key from snake_case to camelCase. Leading underscores preserved. */
export function snakeToCamel(key: string): string {
  const m = key.match(/^(_*)([\s\S]*)$/);
  if (!m) return key;
  const leading = m[1] ?? '';
  const rest = m[2] ?? '';
  const converted = rest.replace(/_([a-zA-Z])/g, (_, c: string) => c.toUpperCase());
  return leading + converted;
}

/** Convert one key from camelCase to snake_case. */
export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export interface DeepConvertOptions {
  /** Keys whose VALUES should be left unconverted at any nesting depth.
   *  Useful for opaque payloads like AuditEvent.details where snake_case
   *  keys inside are meaningful and shouldn't be auto-rewritten. */
  skipKeys?: string[];
}

function transformObject(
  obj: unknown,
  convertKey: (key: string) => string,
  opts: DeepConvertOptions | undefined,
): unknown {
  if (Array.isArray(obj)) return obj.map((v) => transformObject(v, convertKey, opts));
  if (obj === null || typeof obj !== 'object') return obj;
  const skip = new Set(opts?.skipKeys ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = convertKey(key);
    if (skip.has(key) || skip.has(newKey)) {
      out[newKey] = value;
    } else {
      out[newKey] = transformObject(value, convertKey, opts);
    }
  }
  return out;
}

export function deepSnakeToCamel(input: unknown, opts?: DeepConvertOptions): unknown {
  return transformObject(input, snakeToCamel, opts);
}

export function deepCamelToSnake(input: unknown, opts?: DeepConvertOptions): unknown {
  return transformObject(input, camelToSnake, opts);
}
