/**
 * Generic timing wrapper — measures how long an async operation takes
 * without changing what it does or what it returns. Used to instrument
 * specific sub-steps (e.g. the hash-chain write inside a larger request)
 * for the performance benchmark, without altering any business logic.
 */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  return { result, durationMs: Number(end - start) / 1_000_000 };
}
