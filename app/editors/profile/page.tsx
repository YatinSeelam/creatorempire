import { permanentRedirect } from "next/navigation";

/**
 * The profile editor moved into /editors/settings, which now owns everything
 * about the person — the public page, the photo, the account and the work
 * details — instead of splitting it across three screens.
 *
 * Kept as a redirect rather than deleted: this url is in the rail's history for
 * anybody who used it, and a 404 on a page somebody bookmarked is a worse
 * answer than sending them to where it went.
 */
export default function EditorProfilePage() {
  permanentRedirect("/editors/settings");
}
