import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_SUFFIXES = ["acme.com", "acme.dev"];

function isTrusted(origin: string): boolean {
  const host = origin.replace(/^https?:\/\//, "");
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const response =
    request.method === "OPTIONS"
      ? new NextResponse(null, { status: 204 })
      : NextResponse.next();

  if (origin && isTrusted(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.append("Vary", "Origin");
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
