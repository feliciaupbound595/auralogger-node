import { buildProjAuthUrl, resolveApiBaseUrl, resolveWsBaseUrl } from "../utils/backend-origin";
import { DEFAULT_SOCKET_IDLE_CLOSE_MS } from "../utils/socket-idle-close";
import { resolveStylesForConsolePrint } from "../utils/env-config";
import { parseErrorBody } from "../utils/http-utils";
import { printLog } from "../cli/services/log-print";
import { buildStyleEntriesFromProjAuth } from "../cli/utility/log-styles";

interface WebSocketLike {
  readyState: number;
  send(data: string, cb?: (error?: Error) => void): void;
  close(): void;
  on?(event: string, cb: (...args: unknown[]) => void): void;
  once?(event: string, cb: (...args: unknown[]) => void): void;
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
const BATCH_FLUSH_INTERVAL_MS = 30;
const BATCH_MAX_SIZE = 30;

let projectToken: string | null = null;
let session: string | null = null;
let styles: unknown = undefined;
let projAuthPromise: Promise<boolean> | null = null;

let socket: WebSocketLike | null = null;
let socketUrl: string | null = null;
let socketIdleTimer: ReturnType<typeof setTimeout> | null = null;

let batch: LogPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

const deferTask =
  typeof setImmediate === "function"
    ? (task: () => void) => setImmediate(task)
    : (task: () => void) => setTimeout(task, 0);

function wsStates(): { CONNECTING: number; OPEN: number; CLOSED: number } {
  const W = (globalThis as { WebSocket?: { CONNECTING?: number; OPEN?: number; CLOSED?: number } })
    .WebSocket;
  return {
    CONNECTING: W?.CONNECTING ?? 0,
    OPEN: W?.OPEN ?? 1,
    CLOSED: W?.CLOSED ?? 3,
  };
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function padMicros(us: number): string {
  return String(us).padStart(6, "0");
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
  if (typeof location !== "string") return undefined;
  const trimmed = location.trim();
  return trimmed || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maybeData(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return data;
  if (!isPlainObject(data)) return undefined;
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function isPlainAuthResponse(v: unknown): v is { project_id?: unknown; session?: unknown; styles?: unknown } {
  return v !== null && typeof v === "object";
}

async function fetchProjAuth(token: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(buildProjAuthUrl(resolveApiBaseUrl(), token), { method: "POST" });
  } catch (err: unknown) {
    console.warn(`auralogger: proj_auth unreachable; local-only logging (${toErrorMessage(err)})`);
    return false;
  }
  if (!response.ok) {
    const body = await parseErrorBody(response).catch(() => "Request failed.");
    console.warn(`auralogger: proj_auth failed; local-only logging (${body})`);
    return false;
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    console.warn("auralogger: proj_auth replied with non-JSON; local-only logging.");
    return false;
  }
  if (!isPlainAuthResponse(data)) {
    console.warn("auralogger: proj_auth response shape unexpected; local-only logging.");
    return false;
  }
  const pid = typeof data.project_id === "string" ? data.project_id.trim() : "";
  const sess = typeof data.session === "string" ? data.session.trim() : "";
  if (!pid || !sess) {
    console.warn("auralogger: proj_auth response missing project id or session; local-only logging.");
    return false;
  }
  session = sess;
  styles = buildStyleEntriesFromProjAuth(data.styles);
  return true;
}

function startProjAuthOnce(): void {
  if (projAuthPromise || !projectToken) return;
  const token = projectToken;
  projAuthPromise = fetchProjAuth(token).catch((err) => {
    console.error(`auralogger: proj_auth failed: ${toErrorMessage(err)}`);
    return false;
  });
}

function clearSocketIdleTimer(): void {
  if (socketIdleTimer !== null) {
    clearTimeout(socketIdleTimer);
    socketIdleTimer = null;
  }
}

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function bumpSocketIdleTimer(ws: WebSocketLike): void {
  const { OPEN } = wsStates();
  clearSocketIdleTimer();
  socketIdleTimer = setTimeout(() => {
    socketIdleTimer = null;
    if (socket !== ws || ws.readyState !== OPEN) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }, DEFAULT_SOCKET_IDLE_CLOSE_MS);
}

function socketOnce(ws: WebSocketLike, event: "open" | "error" | "close", handler: () => void): void {
  if (typeof ws.once === "function") {
    ws.once(event, handler);
    return;
  }
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, () => handler(), { once: true });
  }
}

function attachLifecycle(ws: WebSocketLike, url: string): void {
  const onOpen = () => bumpSocketIdleTimer(ws);
  const onClose = () => {
    clearSocketIdleTimer();
    if (socket === ws) {
      socket = null;
      socketUrl = null;
    }
  };
  const onErr = (...args: unknown[]) => {
    const first = args[0];
    const msg = first instanceof Error ? first.message : String(first ?? "error");
    console.error(`auralogger: [AuraClient] websocket error — ${url} — ${msg}`);
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
    ws.addEventListener("error", (ev) => onErr(ev));
  }
}

function createWebSocket(url: string): WebSocketLike | null {
  const Native = (globalThis as { WebSocket?: new (u: string) => unknown }).WebSocket;
  if (typeof Native !== "function") {
    console.error(
      "auralogger: WebSocket is not available. Use Node and set globalThis.WebSocket from the ws package before calling AuraClient.log.",
    );
    return null;
  }
  try {
    return new Native(url) as WebSocketLike;
  } catch (err: unknown) {
    console.error(`auralogger: could not open websocket. ${toErrorMessage(err)}`);
    return null;
  }
}

function openSocketIfNeeded(): WebSocketLike | null {
  if (!projectToken) return null;
  const { CONNECTING, OPEN, CLOSED } = wsStates();
  const url = `${resolveWsBaseUrl()}/${encodeURIComponent(projectToken)}/create_browser_logs`;
  if (socket && socketUrl === url && (socket.readyState === OPEN || socket.readyState === CONNECTING)) {
    return socket;
  }
  if (socket && socket.readyState !== CLOSED) {
    clearSocketIdleTimer();
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  const fresh = createWebSocket(url);
  if (!fresh) {
    socket = null;
    socketUrl = null;
    return null;
  }
  attachLifecycle(fresh, url);
  socket = fresh;
  socketUrl = url;
  return socket;
}

function sendOverSocket(ws: WebSocketLike, payload: string, onErr: (err: unknown) => void): void {
  const nodeStyle = typeof ws.on === "function";
  try {
    if (nodeStyle) {
      ws.send(payload, (err?: Error) => {
        if (err) onErr(err);
      });
    } else {
      ws.send(payload);
    }
  } catch (err: unknown) {
    onErr(err);
  }
}

async function sendBatch(payloads: LogPayload[]): Promise<boolean> {
  const { OPEN, CONNECTING } = wsStates();
  const ws = openSocketIfNeeded();
  if (!ws) return false;

  let serialized: string;
  try {
    serialized = JSON.stringify(payloads);
  } catch (err: unknown) {
    console.error(`auralogger: failed to serialize log batch: ${toErrorMessage(err)}`);
    return false;
  }

  const onSendErr = (err: unknown) => {
    console.error(`auralogger: websocket send failed: ${toErrorMessage(err)}`);
  };

  if (ws.readyState === OPEN) {
    bumpSocketIdleTimer(ws);
    sendOverSocket(ws, serialized, onSendErr);
    return true;
  }
  if (ws.readyState === CONNECTING) {
    socketOnce(ws, "open", () => {
      bumpSocketIdleTimer(ws);
      sendOverSocket(ws, serialized, onSendErr);
    });
    return true;
  }
  return false;
}

async function flushNow(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  clearFlushTimer();
  try {
    if (!projAuthPromise) return;
    const ok = await projAuthPromise;
    if (!ok || !session) {
      batch = [];
      return;
    }
    const liveSession = session;
    while (batch.length > 0) {
      const slice = batch.slice(0, BATCH_MAX_SIZE);
      for (const p of slice) p.session = liveSession;
      const sent = await sendBatch(slice);
      if (!sent) {
        scheduleFlush();
        break;
      }
      batch.splice(0, slice.length);
    }
  } finally {
    flushInFlight = false;
    if (batch.length > 0) scheduleFlush();
  }
}

function scheduleFlush(): void {
  clearFlushTimer();
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, BATCH_FLUSH_INTERVAL_MS);
}

function processLog(type: string, message: string, nowMs: number, location?: string, data?: unknown): void {
  const payload: LogPayload = {
    type: normalizeType(type),
    message: String(message ?? ""),
    session: session ?? LOCAL_FALLBACK_SESSION,
    created_at: createIsoTimestampWithMicroseconds(nowMs),
  };
  const loc = normalizeLocation(location);
  if (loc) payload.location = loc;
  const d = maybeData(data);
  if (d) payload.data = d;

  try {
    printLog(payload, resolveStylesForConsolePrint(styles));
  } catch (err: unknown) {
    console.error(`auralogger: failed to print log: ${toErrorMessage(err)}`);
  }

  if (!projectToken) return;

  startProjAuthOnce();

  const wasEmpty = batch.length === 0;
  batch.push(payload);
  if (batch.length >= BATCH_MAX_SIZE) {
    void flushNow();
    return;
  }
  if (wasEmpty) scheduleFlush();
}

export class AuraClient {
  /**
   * @param projectToken Project token string, or `{ projectToken }` (object form accepted for convenience).
   */
  static configure(input: string | { projectToken: unknown }): void {
    const raw = typeof input === "string" ? input : input?.projectToken;
    const token = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();

    session = null;
    styles = undefined;
    projAuthPromise = null;
    batch = [];
    clearFlushTimer();
    flushInFlight = false;

    if (!token) {
      projectToken = null;
      console.warn(
        "auralogger: AuraClient.configure called with empty token; continuing in local-only mode.",
      );
      return;
    }
    projectToken = token;
    startProjAuthOnce();
  }

  static log(type: string, message: string, location?: string, data?: unknown): void {
    const nowMs = Date.now();
    deferTask(() => {
      try {
        processLog(type, message, nowMs, location, data);
      } catch (err: unknown) {
        console.error(`auralogger: log dispatch failed: ${toErrorMessage(err)}`);
      }
    });
  }

  static async closeSocket(timeoutMs = 1000): Promise<void> {
    // Drain pending deferTask callbacks so log() calls made just before closeSocket()
    // get a chance to enqueue their payloads.
    await new Promise<void>((resolve) => deferTask(resolve));
    if (projAuthPromise) {
      try {
        await projAuthPromise;
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => deferTask(resolve));
    await flushNow();
    clearSocketIdleTimer();
    if (!socket) return;

    const { CONNECTING, OPEN, CLOSED } = wsStates();
    const ws = socket;
    if (ws.readyState === CLOSED) {
      socket = null;
      socketUrl = null;
      return;
    }
    if (ws.readyState === CONNECTING) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        socketOnce(ws, "open", () => {
          clearTimeout(t);
          resolve();
        });
        socketOnce(ws, "error", () => {
          clearTimeout(t);
          resolve();
        });
        socketOnce(ws, "close", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (ws.readyState !== OPEN) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const fin = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const t = setTimeout(fin, timeoutMs);
      socketOnce(ws, "close", () => {
        clearTimeout(t);
        fin();
      });
      socketOnce(ws, "error", () => {
        clearTimeout(t);
        fin();
      });
      try {
        ws.close();
      } catch {
        clearTimeout(t);
        fin();
      }
    });
  }
}
