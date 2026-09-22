function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[${timestamp()}] [checkpoint-worker] ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[${timestamp()}] [checkpoint-worker] WARN ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[${timestamp()}] [checkpoint-worker] ERROR ${msg}`, meta ? JSON.stringify(meta) : ""),
};
