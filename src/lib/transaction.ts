export async function executeInTransaction<T>(client: any, fn: (tx: any) => Promise<T>): Promise<T> {
  if ('$transaction' in client) {
    return client.$transaction(fn);
  }
  return fn(client);
}
