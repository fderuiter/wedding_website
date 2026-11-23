export declare const INTERNAL_SOCKET_IP_HEADER = 'x-internal-socket-ip';
export declare const INTERNAL_SOCKET_IP_SIG_HEADER = 'x-internal-socket-ip-sig';

interface SocketBearingIncomingMessage {
  headers?: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
}

export declare function normalizeSocketIp(_rawIp: unknown): string | null;

export declare function getOrCreateSocketIpSecret(): string;

export declare function stripInternalSocketIpHeaders(_req: SocketBearingIncomingMessage): void;

export declare function stampIncomingMessageSocketIp(
  _req: SocketBearingIncomingMessage
): string | null;

export declare function installHttpSocketIpBoundary(): void;

export declare function createVerifiedSocketIpHeaders(
  _remoteAddress: string,
  _extraHeaders?: Record<string, string>
): Record<string, string>;

export declare function readVerifiedSocketIp(_headers: unknown): string | null;
