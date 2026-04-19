const STUB_MESSAGE =
  "auralogger: AuraServer is only available on Node. Use AuraClient in the browser, or keep AuraServer in server-only code (e.g. a Route Handler / API route).";

/**
 * Browser bundle stub: real AuraServer lives in server-log.ts (Node + ws).
 * Prevents importing ws in client builds while keeping the same export name.
 */
export class AuraServer {
  static onlylocal: boolean | null = null;

  static configure(
    _projectToken: string,
    _userSecret?: string,
    onlylocal?: boolean | null,
  ): void {
    if (onlylocal !== undefined) {
      AuraServer.onlylocal = onlylocal;
    }
    // no-op in the browser stub
  }

  static async syncFromSecret(
    _projectToken: string,
    _userSecret?: string,
  ): Promise<void> {
    throw new Error(STUB_MESSAGE);
  }

  static log(
    _type: string,
    _message: string,
    _location?: string,
    _data?: unknown,
  ): void {
    throw new Error(STUB_MESSAGE);
  }

  static async closeSocket(_timeoutMs = 1000): Promise<void> {
    // No-op: no server socket in the browser stub.
  }
}
