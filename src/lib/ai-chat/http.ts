import { NextResponse } from "next/server";
import { AppError, type ErrorParams } from "@/lib/errors";
import { handleApiError } from "@/lib/utils/api";

/**
 * Chat route errors: `{ error, code, statusCode }`, `error` translated into
 * the request language. The stream client (`useChat`) only receives the raw
 * response body: the status is included to tell a refusal (403, quota)
 * from a reply already in progress (409).
 */
export function chatError(code: string, status?: number, params?: ErrorParams): Promise<Response> {
  return handleChatError(new AppError(code, { status, params }));
}

export async function handleChatError(error: unknown): Promise<Response> {
  const base = await handleApiError(error);
  const body = (await base.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json({ ...body, statusCode: base.status }, { status: base.status });
}
