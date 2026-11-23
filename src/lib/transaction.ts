type PostCommitCallback = () => unknown | Promise<unknown>;

const activeTransactionCallbacks = new WeakMap<object, PostCommitCallback[]>();

export function deferAfterCommit(txClient: unknown, callback: PostCommitCallback): boolean {
  if (txClient && typeof txClient === 'object') {
    const pending = activeTransactionCallbacks.get(txClient);
    if (pending) {
      pending.push(callback);
      return true;
    }
  }
  return false;
}

export async function executeInTransaction<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (_tx: any) => Promise<T>
): Promise<T> {
  if (
    client &&
    typeof client === 'object' &&
    '$transaction' in client &&
    typeof client.$transaction === 'function'
  ) {
    let committedCallbacks: PostCommitCallback[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await client.$transaction(async (tx: any) => {
      const hasTxObject = Boolean(tx && typeof tx === 'object');
      const isNested = hasTxObject && activeTransactionCallbacks.has(tx);
      const txCallbacks: PostCommitCallback[] = [];
      if (hasTxObject && !isNested) {
        activeTransactionCallbacks.set(tx, txCallbacks);
      }
      try {
        const txResult = await fn(tx);
        if (!isNested) {
          committedCallbacks = txCallbacks;
        }
        return txResult;
      } finally {
        if (hasTxObject && !isNested) {
          activeTransactionCallbacks.delete(tx);
        }
      }
    });
    if (committedCallbacks.length > 0) {
      const callbacksToRun = committedCallbacks;
      void Promise.resolve().then(() => {
        for (const callback of callbacksToRun) {
          void callback();
        }
      });
    }
    return result;
  }

  if (client && typeof client === 'object' && !activeTransactionCallbacks.has(client)) {
    const txCallbacks: PostCommitCallback[] = [];
    activeTransactionCallbacks.set(client, txCallbacks);
    try {
      const result = await fn(client);
      if (txCallbacks.length > 0) {
        const callbacksToRun = [...txCallbacks];
        void Promise.resolve().then(() => {
          for (const callback of callbacksToRun) {
            void callback();
          }
        });
      }
      return result;
    } finally {
      activeTransactionCallbacks.delete(client);
    }
  }

  return fn(client);
}
