import { cookies } from "next/headers";
import { readTz, TZ_COOKIE } from "@/lib/tz";

/** The zone the person on this request plans in. UTC until the browser has
 *  written the cookie, which `TzSync` does on the first paint. */
export async function currentTz(): Promise<string> {
  return readTz((await cookies()).get(TZ_COOKIE)?.value);
}
