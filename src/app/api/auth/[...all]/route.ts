import { auth } from "@/lib/auth";
import { isHttpAuthEndpoint } from "@/lib/auth-endpoints";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);

// Only the endpoints listed in auth-endpoints.ts are served over HTTP.
function guard(serve: (request: Request) => Promise<Response>) {
  return (request: Request) =>
    isHttpAuthEndpoint(request.method, new URL(request.url).pathname)
      ? serve(request)
      : new Response(null, { status: 404 });
}

export const GET = guard(handler.GET);
export const POST = guard(handler.POST);
