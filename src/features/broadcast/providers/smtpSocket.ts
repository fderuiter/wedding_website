import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import type { ResolvedAddress } from '@/utils/ssrf';

/**
 * Creates a custom Node socket `lookup` function pinned to a pre-validated IP address
 * and address family so `net.connect` and `tls.connect` never perform a second OS DNS lookup.
 */
export function createPinnedSmtpLookup(address: string, family: number): net.LookupFunction {
  return (_hostname, opts, cb) => {
    let callback = cb as (
      err: NodeJS.ErrnoException | null,
      addressOrAddresses: string | dns.LookupAddress[],
      resolvedFamily?: number
    ) => void;
    let options: dns.LookupOptions = typeof opts === 'object' && opts !== null ? opts : {};
    if (typeof opts === 'function') {
      callback = opts as unknown as typeof callback;
      options = {};
    }
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

export function buildPinnedSmtpTlsOptions(params: {
  resolved: ResolvedAddress;
  port: number;
  servername?: string;
  rejectUnauthorized: boolean;
}): tls.ConnectionOptions & { family: number } {
  const { resolved, port, servername, rejectUnauthorized } = params;
  return {
    host: resolved.address,
    port,
    family: resolved.family,
    lookup: createPinnedSmtpLookup(resolved.address, resolved.family),
    servername,
    rejectUnauthorized,
  };
}

export function buildPinnedSmtpNetOptions(params: {
  resolved: ResolvedAddress;
  port: number;
}): net.TcpSocketConnectOpts {
  const { resolved, port } = params;
  return {
    host: resolved.address,
    port,
    family: resolved.family,
    lookup: createPinnedSmtpLookup(resolved.address, resolved.family),
  };
}
