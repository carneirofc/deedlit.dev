import { type NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { method, nextUrl } = req;
  const path = nextUrl.pathname + (nextUrl.search || "");
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[api] ${ts}  ${method.padEnd(6)} ${path}`);
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
