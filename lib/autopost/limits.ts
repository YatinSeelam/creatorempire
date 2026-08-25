/**
 * The two numbers a caption has to live inside, in one client-safe place.
 *
 * They used to be in three: a const in the action, a `maxLength` typed into the
 * composer, and an unexported const in the Upload-Post client. A box that lets
 * somebody type past what the server accepts is a round trip to be told so, and
 * a scheduled caption can now be edited from a second box that has to agree
 * with the same server.
 */

/** Upload-Post's ceiling, and the widest the platforms share. */
export const MAX_CAPTION = 2200;

/**
 * YouTube hard caps a video title at 100 characters and an over-long one fails
 * the WHOLE post, a failure mode the sister project hit in production.
 * `publishVideo` handles it by sending a trimmed `youtube_title` alongside the
 * full caption as the description.
 *
 * Their edit endpoint takes no such override, which is the whole reason
 * `editPost` has two mechanisms: a caption over this length on a post that
 * includes YouTube has to be re-sent rather than patched.
 */
export const YOUTUBE_TITLE_MAX = 100;
