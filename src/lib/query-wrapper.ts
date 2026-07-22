export async function withPageQuery<T>(
  queryFn: () => Promise<T> | T,
  fallback: T
): Promise<T> {
  try {
    return await queryFn();
  } catch (error) {
    console.log('[PageQueryError]', error);
    return fallback;
  }
}
