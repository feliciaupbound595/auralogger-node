export interface ParsedFilter {
  field: string;
  op: string | null;
  value: unknown;
}

export interface ParsedGetLogsCommand {
  filters: ParsedFilter[];
}

/**
 * Parses `get-logs` argv after the subcommand (first token must be `get-logs`).
 * See `user-docs/commands.md` (`get-logs` filter grammar).
 */
export function parseCommand(tokens: string[]): ParsedGetLogsCommand {
  if (tokens[0] !== "get-logs") {
    throw new Error("Expected 'get-logs'");
  }

  const filters: ParsedFilter[] = [];
  let i = 1;

  while (i < tokens.length) {
    const fieldToken = tokens[i];
    if (!fieldToken?.startsWith("-")) {
      throw new Error(`Expected field at position ${i}`);
    }

    const field = fieldToken.slice(1);
    i++;

    let op: string | null = null;
    if (tokens[i]?.startsWith("--")) {
      op = tokens[i].slice(2);
      i++;
    }

    const valueToken = tokens[i];
    if (!valueToken) {
      throw new Error(`Missing value for field '${field}'`);
    }

    let value: unknown;
    try {
      value = JSON.parse(valueToken);
    } catch {
      throw new Error(`Invalid JSON for field '${field}'`);
    }

    const numericField = field === "maxcount" || field === "nextpage";
    if (numericField) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Field '${field}' expects a JSON number token (e.g. 50)`);
      }
    } else if (!Array.isArray(value)) {
      throw new Error(`Field '${field}' expects a JSON array token (e.g. ["a"])`);
    }

    i++;
    filters.push({ field, op, value });
  }

  return { filters };
}
