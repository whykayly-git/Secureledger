import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "./session";

export function handleApiError(err: unknown): NextResponse {
  // Next.js signals things like "this route can't be statically rendered
  // because it reads cookies" by throwing a special internal error with a
  // `digest` tag. Let it propagate instead of swallowing it into a 500.
  if (typeof err === "object" && err !== null && "digest" in err && typeof (err as any).digest === "string") {
    const digest = (err as any).digest as string;
    if (digest.startsWith("DYNAMIC_SERVER_USAGE") || digest.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
  }
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("Unhandled API error", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
