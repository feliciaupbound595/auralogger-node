import type { ParsedFilter } from "../utility/parser";

/** Body filter shape for `POST /api/{project_token}/logs`. */
export interface ApiLogFilter {
  field: string;
  op?: string;
  value: unknown;
}

const MAX_MAXCOUNT = 100;

function defaultOpForField(field: string): string {
  if (field.startsWith("data.")) {
    return "eq";
  }
  if (field === "order" || field === "maxcount" || field === "nextpage" || field === "session") {
    return "eq";
  }
  if (field === "message") {
    return "contains";
  }
  if (field === "location") {
    return "in";
  }
  if (field === "time") {
    return "since";
  }
  if (field === "type") {
    return "in";
  }
  throw new Error(`Unknown filter field: ${field}`);
}

function allowedOpsForField(field: string): string[] {
  if (field.startsWith("data.")) {
    return ["eq"];
  }
  switch (field) {
    case "type":
      return ["in", "not-in"];
    case "message":
      return ["contains", "not-contains"];
    case "location":
      return ["in", "not-in"];
    case "time":
      return ["since", "from-to"];
    case "order":
    case "maxcount":
    case "nextpage":
    case "session":
      return ["eq"];
    default:
      return [];
  }
}

export function normalizeAndValidateFilters(parsed: ParsedFilter[]): ApiLogFilter[] {
  return parsed.map((filter) => {
    const defaultOp = defaultOpForField(filter.field);
    const allowedOps = allowedOpsForField(filter.field);
    if (allowedOps.length === 0) {
      throw new Error(`Unknown filter field: ${filter.field}`);
    }

    const resolvedOp = filter.op ?? defaultOp;
    if (!allowedOps.includes(resolvedOp)) {
      throw new Error(
        `Invalid op '${resolvedOp}' for field '${filter.field}'. Allowed: ${allowedOps.join(", ")}`,
      );
    }

    let value = filter.value;
    if (filter.field === "maxcount" && typeof value === "number") {
      value = Math.min(Math.max(0, Math.floor(value)), MAX_MAXCOUNT);
    }
    if (filter.field === "nextpage" && typeof value === "number") {
      value = Math.floor(value);
    }

    const apiFilter: ApiLogFilter = { field: filter.field, value };
    if (resolvedOp !== defaultOp) {
      apiFilter.op = resolvedOp;
    }

    return apiFilter;
  });
}

/**
 * When `AURALOGGER_PROJECT_SESSION` (or Next/Vite aliases) is set, prepends a
 * `session` `eq` filter unless the user already passed `-session`.
 */
export function withDefaultSessionFilter(
  filters: ApiLogFilter[],
  sessionFromEnv: string | undefined,
): ApiLogFilter[] {
  if (!sessionFromEnv) {
    return filters;
  }
  if (filters.some((f) => f.field === "session")) {
    return filters;
  }
  return [{ field: "session", value: [sessionFromEnv] }, ...filters];
}
