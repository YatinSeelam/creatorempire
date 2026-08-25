import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// next 16 renamed middleware.ts to proxy.ts. same runtime, same matcher.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // everything except static assets and image files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
