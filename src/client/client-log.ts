import { buildProjAuthUrl, resolveApiBaseUrl, resolveWsBaseUrl } from "../utils/backend-origin";
import { DEFAULT_SOCKET_IDLE_CLOSE_MS } from "../utils/socket-idle-close";
import { getResolvedProjectToken } from "../utils/env-config";
import { parseErrorBody } from "../utils/http-utils";
import { buildStyleEntriesFromProjAuth } from "../cli/utility/log-styles";

export interface AuraClientConfigureOptions {
  projectToken: string;
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

interface ProjAuthResponse {
  project_id?: string | null;
  session?: string | null;
  styles?: unknown;
}

const UNKNOWN_TYPE = "unknown";

const LOCAL_FALLBACK_SESSION = "auralogger-local-session";

let overrideProjectToken: string | undefined;
let runtimeProjectId: string | null = null;
let runtimeSession: string | null = null;
let runtimeStyles: unknown = undefined;
let hydrateFromSecretPromise: Promise<void> | null = null;

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

function isPlainAuthResponse(value: unknown): value is ProjAuthResponse {
  return value !== null && typeof value === "object";
}

async function fetchProjAuthConfig(projectToken: string): Promise<{
  project_id: string | null;
  session: string | null;
  styles: unknown;
}> {
  const response = await fetch(buildProjAuthUrl(resolveApiBaseUrl(), projectToken), {
    method: "POST",
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger right now — check your network or VPN, then try again. (${msg})`,
    );
  });

  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }

  const authResponse: unknown = await response.json().catch(() => {
    throw new Error("Got a reply, but it wasn’t readable JSON. Try again in a moment.");
  });

  if (!isPlainAuthResponse(authResponse)) {
    throw new Error(
      "The reply didn’t look right. Run auralogger init again or double-check your project token.",
    );
  }

  return {
    project_id: authResponse.project_id ?? null,
    session: authResponse.session ?? null,
    styles: buildStyleEntriesFromProjAuth(authResponse.styles),
  };
}

function applyProjAuthPayload(payload: {
  project_id: string | null;
  session: string | null;
  styles: unknown;
}): void {
  runtimeProjectId = payload.project_id?.trim() ?? null;
  runtimeSession = payload.session?.trim() ?? null;
  runtimeStyles = payload.styles;
  localSessionId = null;
}

function clearHydratedRuntimeConfig(): void {
  runtimeProjectId = null;
  runtimeSession = null;
  runtimeStyles = undefined;
}

async function ensureHydratedRuntimeConfig(): Promise<void> {
  const projectToken = resolvedProjectToken();
  if (!projectToken) {
    return;
  }

  if (runtimeProjectId && runtimeSession && runtimeStyles !== undefined) {
    return;
  }

  if (!hydrateFromSecretPromise) {
    hydrateFromSecretPromise = (async () => {
      const token = resolvedProjectToken();
      if (!token) {
        return;
      }
      const payload = await fetchProjAuthConfig(token);
      const projectId = payload.project_id?.trim() ?? "";
      const session = payload.session?.trim() ?? "";
      if (!projectId || !session) {
        throw new Error("auralogger: proj_auth response missing project id or session.");
      }
      applyProjAuthPayload(payload);
    })();
  }

  try {
    await hydrateFromSecretPromise;
  } catch (error: unknown) {
    hydrateFromSecretPromise = null;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`auralogger: could not load project config from API: ${msg}`);
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

function resolvedProjectToken(): string | undefined {
  if (overrideProjectToken !== undefined) {
    return asNonEmptyString(overrideProjectToken);
  }
  return getResolvedProjectToken();
}

function getProjectId(): string | null {
  return runtimeProjectId;
}

function getSession(): string {
  return runtimeSession ?? getOrCreateLocalSession();
}

function buildWsUrl(projectToken: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectToken)}/create_browser_logs`;
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

/** Uses global WebSocket with path-only auth (`/{proj_token}/create_browser_logs`). */
function createWebSocket(url: string): WebSocketLike | null {
  const NativeWebSocket = (globalThis as {
    WebSocket?: new (u: string, protocolsOrOptions?: unknown) => unknown;
  })
    .WebSocket;
  if (typeof NativeWebSocket === "function") {
    try {
      return new NativeWebSocket(url) as WebSocketLike;
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      console.error(
        `auralogger: could not open websocket to create_browser_logs. ${message}`,
      );
      return null;
    }
  }

  console.error(
    "auralogger: WebSocket is not available. Use Node and set globalThis.WebSocket from the ws package before calling AuraClient.log.",
  );
  return null;
}

function connectSocket(url: string): WebSocketLike | null {
  const ws = createWebSocket(url);
  if (!ws) {
    return null;
  }

  attachAuraClientSocketLifecycle(ws, url);

  return ws;
}

async function ensureSocket(): Promise<WebSocketLike | null> {
  const { CONNECTING, OPEN, CLOSED } = wsStates();
  const projectToken = resolvedProjectToken();
  if (!projectToken) {
    console.error(
      "auralogger: missing project token. Call AuraClient.configure({ projectToken }) before logging.",
    );
    return null;
  }
  await ensureHydratedRuntimeConfig();
  const projectId = getProjectId();
  if (!projectId) {
    console.error(
      "auralogger: proj_auth did not return project id. Verify your project token and backend config.",
    );
    return null;
  }

  const url = buildWsUrl(projectToken);
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

  const connected = connectSocket(url);
  if (!connected) {
    socket = null;
    socketUrl = null;
    return null;
  }
  socket = connected;
  socketUrl = url;
  return socket;
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

  try {
    const ws = await ensureSocket();
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
    const token = options.projectToken.trim();
    if (!token) {
      throw new Error("auralogger: projectToken cannot be empty.");
    }
    overrideProjectToken = token;
    hydrateFromSecretPromise = null;
    clearHydratedRuntimeConfig();
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
