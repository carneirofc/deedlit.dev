import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Security headers applied to all responses
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Block direct access to /images/ directory
  if (pathname.startsWith("/images/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Apply security headers to all responses
  const response = NextResponse.next();
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest).*)"],
};
