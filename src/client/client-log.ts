import { resolveWsBaseUrl } from "../utils/backend-origin";
import { DEFAULT_SOCKET_IDLE_CLOSE_MS } from "../utils/socket-idle-close";
import {
  getResolvedProjectId,
  getResolvedProjectToken,
  getResolvedSession,
  tryParseResolvedStyles,
} from "../utils/env-config";
import { resolveLogStyleSpec } from "../cli/utility/log-styles";

export interface AuraClientConfigureOptions {
  projectToken?: string | null;
  projectId?: string | null;
  session?: string | null;
  /** Style entries (same shape as from `auralogger init`). */
  styles?: unknown | null;
}

interface WebSocketLike {
  readyState: number;
  send(data: string, cb?: (error?: Error) => void): void;
  close(): void;
  terminate?: () => void;
  /** Node `ws` / some polyfills */
  on?(event: string, cb: (...args: unknown[]) => void): void;
  once?(event: string, cb: (...args: unknown[]) => void): void;
  /** Browser / standard WebSocket */
  addEventListener?(
    type: string,
    listener: (ev: unknown) => void,
    options?: boolean | { once?: boolean },
  ): void;
}

interface LogPayload {
  type: string;
  message: string;
  session: string;
  location?: string;
  data?: string;
  created_at: string;
}

const UNKNOWN_TYPE = "unknown";

const LOCAL_FALLBACK_SESSION = "auralogger-local-session";

let overrideProjectId: string | undefined;
let overrideProjectToken: string | undefined;
let overrideSession: string | undefined;
let overrideStyles: unknown | undefined;

let localSessionId: string | null = null;
let socket: WebSocketLike | null = null;
let socketUrl: string | null = null;
let socketIdleTimer: ReturnType<typeof setTimeout> | null = null;

function clearSocketIdleTimer(): void {
  if (socketIdleTimer !== null) {
    clearTimeout(socketIdleTimer);
    socketIdleTimer = null;
  }
}

function bumpSocketIdleTimer(ws: WebSocketLike): void {
  const { OPEN } = wsStates();
  clearSocketIdleTimer();
  socketIdleTimer = setTimeout(() => {
    socketIdleTimer = null;
    if (socket !== ws || ws.readyState !== OPEN) {
      return;
    }
    try {
      ws.close();
    } catch {
      // ignore
    }
  }, DEFAULT_SOCKET_IDLE_CLOSE_MS);
}

const deferTask =
  typeof setImmediate === "function"
    ? (task: () => void) => setImmediate(task)
    : (task: () => void) => setTimeout(task, 0);

function padMicros(microseconds: number): string {
  return String(microseconds).padStart(6, "0");
}

function createIsoTimestampWithMicroseconds(epochMs: number): string {
  const d = new Date(epochMs);
  const iso = d.toISOString();
  const micros = padMicros(d.getUTCMilliseconds() * 1_000);
  return `${iso.slice(0, 19)}.${micros}Z`;
}

function normalizeType(type: string): string {
  return type.trim() ? type.trim() : UNKNOWN_TYPE;
}

function normalizeLocation(location?: string): string | undefined {
  if (typeof location !== "string") {
    return undefined;
  }
  const trimmed = location.trim();
  return trimmed || undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maybeData(data: unknown): string | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }
  if (typeof data === "string") {
    return data;
  }
  if (!isPlainObject(data)) {
    return undefined;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendPayloadOverSocket(
  ws: WebSocketLike,
  sendPayload: string,
  onSendError: (error: unknown) => void,
): void {
  const nodeStyleSocket = typeof ws.on === "function";
  if (nodeStyleSocket) {
    try {
      ws.send(sendPayload, (error?: Error) => {
        if (!error) {
          return;
        }
        onSendError(error);
      });
    } catch (error: unknown) {
      onSendError(error);
    }
    return;
  }

  try {
    ws.send(sendPayload);
  } catch (error: unknown) {
    onSendError(error);
  }
}

function getOrCreateLocalSession(): string {
  if (localSessionId) {
    return localSessionId;
  }
  localSessionId = LOCAL_FALLBACK_SESSION;

  return localSessionId;
}

function resolvedProjectId(): string | undefined {
  if (overrideProjectId !== undefined) {
    return asNonEmptyString(overrideProjectId);
  }
  return getResolvedProjectId();
}

function resolvedProjectToken(): string | undefined {
  if (overrideProjectToken !== undefined) {
    return asNonEmptyString(overrideProjectToken);
  }
  return getResolvedProjectToken();
}

function resolvedSessionRaw(): string | undefined {
  if (overrideSession !== undefined) {
    return asNonEmptyString(overrideSession);
  }
  return getResolvedSession();
}

function parseStylesString(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function resolvedStyles(): unknown {
  if (overrideStyles !== undefined) {
    if (overrideStyles === null) {
      return undefined;
    }
    if (typeof overrideStyles === "string") {
      return parseStylesString(overrideStyles);
    }
    return overrideStyles;
  }
  return tryParseResolvedStyles() ?? undefined;
}

function getProjectId(): string | null {
  return resolvedProjectId() ?? null;
}

function getSession(): string {
  return resolvedSessionRaw() ?? getOrCreateLocalSession();
}

function getConfigStyles(): unknown {
  return resolvedStyles();
}

function buildWsUrl(projectId: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectId)}/create_browser_logs`;
}

function wsStates(): { CONNECTING: number; OPEN: number; CLOSED: number } {
  const W = (globalThis as { WebSocket?: { CONNECTING?: number; OPEN?: number; CLOSED?: number } })
    .WebSocket;
  return {
    CONNECTING: W?.CONNECTING ?? 0,
    OPEN: W?.OPEN ?? 1,
    CLOSED: W?.CLOSED ?? 3,
  };
}

function attachAuraClientSocketLifecycle(ws: WebSocketLike, url: string): void {
  const onOpen = () => {
    bumpSocketIdleTimer(ws);
  };
  const onClose = () => {
    clearSocketIdleTimer();
    if (socket === ws) {
      socket = null;
      socketUrl = null;
    }
  };
  const onErr = (...args: unknown[]) => {
    const first = args[0];
    const message =
      first instanceof Error ? first.message : String(first ?? "error");
    console.error(`auralogger: [AuraClient] websocket error — ${url} — ${message}`);
  };

  if (typeof ws.on === "function") {
    ws.on("open", onOpen);
    ws.on("close", onClose);
    ws.on("error", onErr);
    return;
  }

  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("open", () => onOpen());
    ws.addEventListener("close", () => onClose());
    ws.addEventListener("error", (ev: unknown) => onErr(ev));
    return;
  }

  console.warn(
    "auralogger: [AuraClient] cannot attach lifecycle handlers (unrecognized WebSocket implementation).",
  );
}

/** One-shot listener: supports Node `ws` `.once` and browser `addEventListener(..., { once: true })`. */
function socketOnce(
  ws: WebSocketLike,
  event: "open" | "error" | "close",
  handler: (...args: unknown[]) => void,
): void {
  if (typeof ws.once === "function") {
    ws.once(event, handler);
    return;
  }
  if (typeof ws.addEventListener === "function") {
    const wrapped = (...args: unknown[]) => handler(...args);
    ws.addEventListener(event, wrapped as (ev: unknown) => void, { once: true });
    return;
  }
  console.error(
    `auralogger: [AuraClient] cannot subscribe to websocket "${event}" (missing .once / addEventListener).`,
  );
}

/** Uses global WebSocket. For auth headers, use `ws` in Node by assigning `globalThis.WebSocket`. */
function createWebSocket(url: string, projectToken: string): WebSocketLike | null {
  const NativeWebSocket = (globalThis as {
    WebSocket?: new (u: string, protocolsOrOptions?: unknown) => unknown;
  })
    .WebSocket;
  if (typeof NativeWebSocket === "function") {
    if (isBrowserConsole()) {
      console.error(
        "auralogger: create_browser_logs now requires Authorization header. Browsers cannot set custom websocket headers; use a server relay or run AuraClient from Node with ws.",
      );
      return null;
    }

    try {
      return new NativeWebSocket(url, {
        headers: {
          authorization: `Bearer ${projectToken}`,
        },
      }) as WebSocketLike;
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      console.error(
        `auralogger: could not open authenticated websocket. Ensure globalThis.WebSocket comes from ws (supports headers). ${message}`,
      );
      return null;
    }
  }

  console.error(
    "auralogger: WebSocket is not available. Use Node and set globalThis.WebSocket from the ws package before calling AuraClient.log.",
  );
  return null;
}

function connectSocket(url: string, projectToken: string): WebSocketLike | null {
  const ws = createWebSocket(url, projectToken);
  if (!ws) {
    return null;
  }

  attachAuraClientSocketLifecycle(ws, url);

  return ws;
}

function ensureSocket(): WebSocketLike | null {
  const { CONNECTING, OPEN, CLOSED } = wsStates();
  const projectToken = resolvedProjectToken();
  if (!projectToken) {
    console.error(
      "auralogger: missing AURALOGGER_PROJECT_TOKEN for create_browser_logs websocket auth.",
    );
    return null;
  }
  const projectId = getProjectId();
  if (!projectId) {
    console.error(
      "auralogger: missing NEXT_PUBLIC_AURALOGGER_PROJECT_ID (or VITE_AURALOGGER_PROJECT_ID) in the environment.",
    );
    return null;
  }

  const url = buildWsUrl(projectId);
  if (socket && socketUrl === url && socket.readyState === OPEN) {
    return socket;
  }
  if (socket && socketUrl === url && socket.readyState === CONNECTING) {
    return socket;
  }
  if (socket && socket.readyState !== CLOSED) {
    clearSocketIdleTimer();
    try {
      socket.close();
    } catch {
      // ignore
    }
  }

  const connected = connectSocket(url, projectToken);
  if (!connected) {
    socket = null;
    socketUrl = null;
    return null;
  }
  socket = connected;
  socketUrl = url;
  return socket;
}

function isBrowserConsole(): boolean {
  const w = (globalThis as unknown as { window?: unknown }).window as
    | { document?: unknown; navigator?: unknown }
    | undefined;
  return !!(w && typeof w.document !== "undefined" && typeof w.navigator !== "undefined");
}

function cssRgb(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function printClientLog(payload: LogPayload, configStyles: unknown): void {
  try {
    const spec = resolveLogStyleSpec(payload.type, configStyles);

    if (isBrowserConsole()) {
      const timeStyle = `color:${cssRgb(spec["time-color"])};font-weight:600`;
      const typeStyle = `color:${cssRgb(spec["type-color"])};font-weight:700`;
      const locStyle = `color:${cssRgb(spec["location-color"])};font-weight:600`;
      const msgStyle = `color:${cssRgb(spec["message-color"])};font-weight:400`;

      const loc = payload.location ? ` ${payload.location}` : "";
      console.log(
        `%c${payload.created_at}%c ${spec.icon} %c${payload.type}%c${loc}`,
        timeStyle,
        "color:inherit",
        typeStyle,
        locStyle,
      );
      console.log(`%c${payload.message}`, msgStyle);
      return;
    }

    console.log(
      `${payload.created_at} ${spec.icon} [AuraClient] ${payload.type} ${payload.location ?? ""} ${payload.message}`,
    );
  } catch {
    // Fallback must always succeed even with malformed styles config.
    console.log(
      `${payload.created_at} [AuraClient] ${payload.type} ${payload.location ?? ""} ${payload.message}`,
    );
  }
}

async function processClientlogAsync(
  type: string,
  message: string,
  nowMs: number,
  location?: string,
  data?: unknown,
): Promise<void> {
  const { CONNECTING, OPEN } = wsStates();
  const payload: LogPayload = {
    type: normalizeType(type),
    message: String(message ?? ""),
    session: getSession(),
    created_at: createIsoTimestampWithMicroseconds(nowMs),
  };
  const normalizedLocation = normalizeLocation(location);
  if (normalizedLocation) {
    payload.location = normalizedLocation;
  }
  const normalizedData = maybeData(data);
  if (normalizedData) {
    payload.data = normalizedData;
  }

  printClientLog(payload, getConfigStyles());

  try {
    const ws = ensureSocket();
    if (!ws) {
      console.error("auralogger: websocket unavailable; log payload:", payload);
      return;
    }
    if (ws.readyState === OPEN) {
      bumpSocketIdleTimer(ws);
    }

    let sendPayload = "";
    try {
      sendPayload = JSON.stringify(payload);
    } catch (error: unknown) {
      const errMsg = toErrorMessage(error);
      console.error(`auralogger: failed to serialize log payload: ${errMsg}`);
      console.error("auralogger: failed payload:", payload);
      return;
    }

    if (ws.readyState === OPEN) {
      sendPayloadOverSocket(ws, sendPayload, (error: unknown) => {
        const sendErr = toErrorMessage(error);
        console.error(`auralogger: websocket send failed: ${sendErr}`);
        console.error("auralogger: failed payload:", payload);
      });
      return;
    }

    if (ws.readyState === CONNECTING) {
      socketOnce(ws, "open", () => {
        bumpSocketIdleTimer(ws);
        sendPayloadOverSocket(ws, sendPayload, (error: unknown) => {
          const sendErr = toErrorMessage(error);
          console.error(`auralogger: websocket send failed: ${sendErr}`);
          console.error("auralogger: failed payload:", payload);
        });
      });
      socketOnce(ws, "error", () => {
        console.error("auralogger: websocket unavailable; log payload:", payload);
      });
      return;
    }

    console.error("auralogger: websocket unavailable; log payload:", payload);
  } catch (error: unknown) {
    const sendErr = toErrorMessage(error);
    console.error(`auralogger: websocket dispatch failed: ${sendErr}`);
    console.error("auralogger: failed payload:", payload);
  }
}

export class AuraClient {
  static configure(options: AuraClientConfigureOptions): void {
    if ("projectToken" in options) {
      overrideProjectToken =
        options.projectToken === null || options.projectToken === undefined
          ? undefined
          : options.projectToken;
    }
    if ("projectId" in options) {
      overrideProjectId =
        options.projectId === null || options.projectId === undefined
          ? undefined
          : options.projectId;
    }
    if ("session" in options) {
      overrideSession =
        options.session === null || options.session === undefined
          ? undefined
          : options.session;
    }
    if ("styles" in options) {
      overrideStyles =
        options.styles === null || options.styles === undefined
          ? undefined
          : options.styles;
    }
    localSessionId = null;
  }

  static log(type: string, message: string, location?: string, data?: unknown): void {
    const nowMs = Date.now();
    deferTask(() => {
      void processClientlogAsync(type, message, nowMs, location, data).catch(
        (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`auralogger: log dispatch failed: ${errorMessage}`);
        },
      );
    });
  }

  static async closeSocket(timeoutMs = 1000): Promise<void> {
    clearSocketIdleTimer();
    if (!socket) {
      return;
    }

    const { CONNECTING, OPEN, CLOSED } = wsStates();
    const ws = socket;
    if (ws.readyState === CLOSED) {
      socket = null;
      socketUrl = null;
      return;
    }

    if (ws.readyState === CONNECTING) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, timeoutMs);
        socketOnce(ws, "open", () => {
          clearTimeout(timeout);
          resolve();
        });
        socketOnce(ws, "error", () => {
          clearTimeout(timeout);
          resolve();
        });
        socketOnce(ws, "close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    if (ws.readyState !== OPEN) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const timeout = setTimeout(done, timeoutMs);

      socketOnce(ws, "close", () => {
        clearTimeout(timeout);
        done();
      });
      socketOnce(ws, "error", () => {
        clearTimeout(timeout);
        done();
      });

      try {
        ws.close();
      } catch {
        clearTimeout(timeout);
        done();
      }
    });
  }
}
