import chalk from "chalk";

import { resolveLogStyleSpec } from "../utility/log-styles";

export interface PrintableLogRow {
  created_at?: unknown;
  type?: unknown;
  location?: unknown;
  message?: unknown;
  data?: unknown;
}

function formatCreatedAtTimeOnly(createdAt: unknown): string {
  if (createdAt == null || createdAt === "") {
    return "";
  }
  const d =
    createdAt instanceof Date
      ? createdAt
      : new Date(
          typeof createdAt === "string" || typeof createdAt === "number"
            ? createdAt
            : String(createdAt),
        );
  if (Number.isNaN(d.getTime())) {
    return typeof createdAt === "string" ? createdAt : String(createdAt);
  }
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function printLogPlain(log: PrintableLogRow): void {
  const ts = formatCreatedAtTimeOnly(log.created_at);
  const type = typeof log.type === "string" ? log.type : String(log.type ?? "");
  const loc = String(log.location ?? "");
  const msg = String(log.message ?? "");
  console.log(`${ts} ${type} ${loc}`.trim(), msg);
}

function rgbPaint(rgb: [number, number, number], text: unknown): string {
  const s = String(text ?? "");
  const [r, g, b] = rgb;
  if (![r, g, b].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return s;
  }
  try {
    return chalk.rgb(r, g, b)(s);
  } catch {
    return s;
  }
}

export function printLog(log: PrintableLogRow, configStyles: unknown): void {
  try {
    const spec = resolveLogStyleSpec(
      typeof log.type === "string" ? log.type : "",
      configStyles,
    );
    const loc = String(log.location ?? "");
    console.log(
      rgbPaint(spec["time-color"], formatCreatedAtTimeOnly(log.created_at)),
      spec.icon,
      rgbPaint(spec["type-color"], log.type),
      rgbPaint(spec["location-color"], loc),
    );
    console.log(rgbPaint(spec["message-color"], String(log.message ?? "")));
  } catch {
    printLogPlain(log);
  }
}
