export function dispatchDemoApiRequest(
  _input: RequestInfo | URL,
  _init?: RequestInit
): Promise<Response | null> {
  return Promise.resolve(null);
}

export function installDemoFetchInterceptor(): () => void {
  return () => {};
}
