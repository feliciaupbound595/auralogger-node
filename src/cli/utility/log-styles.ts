/** One log type’s terminal/UI styling (RGB triples are [r, g, b]). */
export interface LogStyleSpec {
  icon: string;
  "type-color": [number, number, number];
  background: [number, number, number];
  borderColor: [number, number, number];
  "location-color": [number, number, number];
  "time-color": [number, number, number];
  "message-color": [number, number, number];
  "text-color": [number, number, number];
}

/** Row from `proj_auth` / `GET /api/styles` before CLI normalization. */
export interface ApiStyleRow {
  type?: string;
  styles?: Record<string, unknown>;
  importance?: number;
}

export interface ProjAuthConfigPayload {
  project_id: string | null;
  /** Optional: allows CLI/SDK to label output with a human name. */
  project_name?: string | null;
  session: string | null;
  styles: Record<string, LogStyleSpec | Record<string, unknown>>[];
}

export const DEFAULT_LOG_STYLE_SPEC: LogStyleSpec = {
  icon: "🗒️",
  "type-color": [23, 230, 154],
  background: [0, 0, 0],
  borderColor: [255, 255, 255],
  "location-color": [63, 102, 191],
  "time-color": [129, 68, 235],
  "message-color": [235, 68, 210],
  "text-color": [255, 255, 255],
};

function cloneDefaultSpec(): LogStyleSpec {
  return JSON.parse(JSON.stringify(DEFAULT_LOG_STYLE_SPEC)) as LogStyleSpec;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds `styles` for `NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES` / `VITE_AURALOGGER_PROJECT_STYLES`
 * (JSON env) after init.
 * Shape: array of objects, each with a single key (log type string) and a style spec object as value.
 * Always includes `default`; server rows override or add types (by `importance` ascending).
 */
export function buildStyleEntriesFromApi(
  rows: unknown,
): Record<string, LogStyleSpec | Record<string, unknown>>[] {
  const map: Record<string, LogStyleSpec | Record<string, unknown>> = {
    default: cloneDefaultSpec(),
  };
  const list = Array.isArray(rows) ? rows : [];
  const sorted = [...list].sort(
    (a, b) =>
      Number(isPlainObject(a) ? (a as ApiStyleRow).importance ?? 0 : 0) -
      Number(isPlainObject(b) ? (b as ApiStyleRow).importance ?? 0 : 0),
  );

  for (const row of sorted) {
    if (!isPlainObject(row)) continue;
    const r = row as ApiStyleRow;
    const t = typeof r.type === "string" ? r.type.trim() : "";
    if (!t) continue;

    const inner = isPlainObject(r.styles) ? r.styles : {};

    if (t === "default") {
      Object.assign(map.default as Record<string, unknown>, inner);
    } else if (Object.keys(inner).length > 0) {
      map[t] = inner;
    }
  }

  return Object.entries(map).map(([type, spec]) => ({ [type]: spec }));
}

/** Map `proj_auth` per-type style objects (camelCase API fields) to row `styles` for {@link buildStyleEntriesFromApi}. */
function mapProjAuthTypeStyle(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pairs: [string, string][] = [
    ["typeColor", "type-color"],
    ["locationColor", "location-color"],
    ["timeColor", "time-color"],
    ["messageColor", "message-color"],
    ["textColor", "text-color"],
    ["backgroundColor", "background"],
  ];
  if (typeof spec.icon === "string") {
    out.icon = spec.icon;
  }
  for (const [camel, kebab] of pairs) {
    if (camel in spec) {
      out[kebab] = spec[camel];
    }
  }
  if ("borderColor" in spec) {
    out.borderColor = spec.borderColor;
  }
  return out;
}

/**
 * Normalizes `styles` from `POST /api/{project_token}/proj_auth`:
 * - `null` / missing → default-only entries
 * - array → {@link buildStyleEntriesFromApi}
 * - object keyed by log type (each value: API shape with `typeColor`, …) → rows for {@link buildStyleEntriesFromApi}
 */
export function buildStyleEntriesFromProjAuth(
  styles: unknown,
): Record<string, LogStyleSpec | Record<string, unknown>>[] {
  if (styles === null || styles === undefined) {
    return buildStyleEntriesFromApi([]);
  }
  if (Array.isArray(styles)) {
    return buildStyleEntriesFromApi(styles);
  }
  if (!isPlainObject(styles)) {
    return buildStyleEntriesFromApi([]);
  }
  const rows: unknown[] = [];
  for (const [type, spec] of Object.entries(styles)) {
    const t = type.trim();
    if (!t || !isPlainObject(spec)) {
      continue;
    }
    rows.push({ type: t, styles: mapProjAuthTypeStyle(spec) });
  }
  return buildStyleEntriesFromApi(rows);
}

/**
 * Flattens config `styles` into one object per type.
 */
export function styleMapFromConfigEntries(
  entries: unknown,
): Record<string, LogStyleSpec | Record<string, unknown>> {
  const byType: Record<string, LogStyleSpec | Record<string, unknown>> = {};

  if (!Array.isArray(entries)) {
    byType.default = cloneDefaultSpec();
    return byType;
  }

  for (const item of entries) {
    if (!isPlainObject(item)) continue;

    for (const [k, v] of Object.entries(item)) {
      if (isPlainObject(v)) {
        byType[k] = v;
      }
    }
  }

  if (!byType.default) {
    byType.default = cloneDefaultSpec();
  }

  return byType;
}

/**
 * Resolved spec for a log line: per-type fields merged over `default`, then default alone if unknown type.
 */
export function resolveLogStyleSpec(
  logType: string,
  configStyles: unknown,
): LogStyleSpec {
  const map = styleMapFromConfigEntries(configStyles);
  const base = (map.default as LogStyleSpec | undefined) ?? cloneDefaultSpec();
  const t =
    typeof logType === "string" && logType.trim() ? logType.trim() : "unknown";
  const specific = map[t];
  if (!specific) {
    return { ...base };
  }
  return { ...base, ...specific } as LogStyleSpec;
}
