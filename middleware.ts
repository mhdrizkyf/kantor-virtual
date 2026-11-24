import { NextResponse, type NextRequest } from "next/server";
import { checkApiRequest } from "./lib/request-guard";

export function middleware(req: NextRequest) {
  const verdict = checkApiRequest(req);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
