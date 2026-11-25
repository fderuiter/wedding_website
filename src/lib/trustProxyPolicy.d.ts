export declare const PRODUCTION_PUBLIC_TRUST_PROXY_ERROR: string;

export declare function isLocalOrInternalHostname(_hostname: string): boolean;

export declare function hasNonLocalAllowedHosts(_allowedHostsRaw: string | undefined): boolean;

export declare function isExplicitTrustProxyHopCount(_val: unknown): boolean;

export declare function isValidTrustProxyInput(_val: unknown): boolean;

export declare function parseTrustProxyValue(_val: unknown): boolean | number;

export interface ProductionTrustProxyCheckInput {
  isProduction: boolean;
  isBuildTime?: boolean;
  isE2ETestMode?: boolean;
  allowedHosts: string | undefined;
  rawTrustProxy?: unknown;
  parsedTrustProxy?: boolean | number;
}

export declare function getProductionTrustProxyError(
  _input: ProductionTrustProxyCheckInput
): string | null;
