import type { Metadata } from "next";
import { BrandMark } from "@/components/dash/brand-mark";
import { DownloadAll } from "@/components/handoff/download-all";
import { brandLogo } from "@/lib/brand-catalog";
import { humanSize } from "@/lib/editing-files";
import { HANDOFF_KIND_LABEL, FILE_KIND_LABEL } from "@/lib/editing-handoff";
import { loadHandoffRoom, type RoomFile } from "@/lib/editing-handoff-server";
import type { LinkItem } from "@/lib/editing";
import { shortDate } from "@/lib/money";

/**
 * The editor handoff room, `creatorempire.app/handoff/<token>`.
 *
 * Whoever holds this url is the person cutting the batch. They have no account
 * here and never will: they are on discord, or telegram, or upwork, and what
 * they used to get was a drive folder and a paragraph pasted into a dm. So this
 * is that, assembled: the brief, the style, the references, every video, the
 * brand's shelf, each one downloadable, on one page with no login and no nav.
 *
 * What is NOT on this page is the design. No pay, no credits, no owner name, no
 * cuts that came back — `handoff_link_room` never returns them, so this file
 * could not leak them if it tried. What the creator is paying for this batch is
 * between them and whoever they are paying.
 *
 * Read only, all the way down. There is no form here, because a delivery that
 * an anonymous url holder could write is a delivery anyone holding the url
 * could forge. The cut comes back the way it always did and the creator files
 * it on their own page.
 *
 * Dynamic on purpose: the rpc counts the view, which is the creator's only
 * signal that the link actually landed.
 */

export const dynamic = "force-dynamic";

// a capability url must never end up in an index. it is not a secret page, it
// is a secret address, and the two fail the same way.
export const metadata: Metadata = {
  title: "The batch",
  robots: { index: false, follow: false, nocache: true },
};

type Props = { params: Promise<{ token: string }> };

const LABEL = "text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-shell">
      <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:py-14">{children}</div>
    </main>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-paper px-5 py-5 sm:px-6 sm:py-6 ${className}`}
    >
      {children}
    </section>
  );
}

function Footer() {
  return (
    <p className="mt-6 text-center text-[12.5px] text-ink-50">
      sent with{" "}
      <a
        href="https://www.creatorempire.app"
        className="font-semibold hover:text-flame-dark"
      >
        creator empire
      </a>
    </p>
  );
}

/** A dead link says which way it died, because "404" sends people to slack. */
function Closed({ reason }: { reason: "missing" | "revoked" | "expired" }) {
  const copy = {
    missing: {
      head: "this link does not open",
      body: "it was never made, or it has been replaced by a new one. ask whoever sent it for the current link.",
    },
    revoked: {
      head: "this handoff is closed",
      body: "the creator turned this link off. ask them for a fresh one if you still need the files.",
    },
    expired: {
      head: "this link has run out",
      body: "it was set to stop working by now. ask whoever sent it for a fresh one.",
    },
  }[reason];

  return (
    <Shell>
      <Card className="text-center">
        <p className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.head}</p>
        <p className="mx-auto mt-2 max-w-[42ch] text-[14.5px] leading-[1.65] text-ink-50">
          {copy.body}
        </p>
      </Card>
      <Footer />
    </Shell>
  );
}

/**
 * One video to cut: played inline so the editor can check it is the right take
 * before pulling 400 MB down, with the download beside it.
 *
 * `preload="metadata"` and no autoplay on purpose. A batch is eight or nine
 * files and a page that starts buffering all of them costs the editor their
 * bandwidth before they have clicked anything.
 */
function Clip({ file }: { file: RoomFile }) {
  return (
    <div className="space-y-2.5 rounded-xl border border-line bg-shell p-3">
      {file.url && file.playable ? (
        <video
          src={file.url}
          controls
          preload="metadata"
          playsInline
          className="w-full rounded-lg bg-black"
        />
      ) : file.url && file.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt=""
          className="w-full rounded-lg border border-line object-cover"
        />
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {file.name}
        </span>
        {file.size_bytes ? (
          <span className="shrink-0 text-[12.5px] tabular-nums text-ink-50">
            {humanSize(file.size_bytes)}
          </span>
        ) : null}
        {file.downloadUrl ? (
          <a
            href={file.downloadUrl}
            className="shrink-0 rounded-pill bg-ink px-4 py-1.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
          >
            Download
          </a>
        ) : (
          <span className="shrink-0 text-[12.5px] text-ink-50">unavailable</span>
        )}
      </div>
    </div>
  );
}

/** Everything that is not a video to cut: one dense row each. */
function FileRow({ file }: { file: RoomFile }) {
  return (
    <li className="flex min-w-0 items-center gap-3">
      {file.image && file.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt=""
          className="size-10 shrink-0 rounded-lg border border-line object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-shell text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
          {FILE_KIND_LABEL[file.kind] ?? file.kind}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{file.name}</p>
        {file.size_bytes ? (
          <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-50">
            {humanSize(file.size_bytes)}
          </p>
        ) : null}
      </div>
      {file.downloadUrl ? (
        <a
          href={file.downloadUrl}
          className="shrink-0 text-[13px] font-semibold text-ink-70 transition-colors hover:text-flame-dark"
        >
          Download
        </a>
      ) : (
        <span className="shrink-0 text-[12.5px] text-ink-50">unavailable</span>
      )}
    </li>
  );
}

function Links({ label, items }: { label: string; items: LinkItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((link, i) => (
          <li key={i} className="min-w-0">
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[14px] font-semibold text-ink-70 transition-colors hover:text-flame-dark"
            >
              {link.label || link.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function HandoffPage({ params }: Props) {
  const { token } = await params;
  const result = await loadHandoffRoom(token);
  if (!result.ok) return <Closed reason={result.reason} />;

  const { room } = result;
  const { job } = room;
  const kind = HANDOFF_KIND_LABEL[job.tier] ?? "edit";
  const hasShelf = room.shelf.length > 0;
  const hasSide = room.assets.length > 0 || room.docs.length > 0 || hasShelf;

  // every file on the page, for the button that saves the lot. built here so
  // the two "download all" buttons cannot disagree about what "all" means.
  const saveable = (rows: RoomFile[]) =>
    rows
      .filter((f) => f.downloadUrl)
      .map((f) => ({ name: f.name, url: f.downloadUrl as string }));
  const everything = saveable([
    ...room.footage,
    ...room.assets,
    ...room.docs,
    ...room.shelf,
  ]);

  return (
    <Shell>
      <div className="space-y-4">
        {/* ------------------------------------------------------- the head */}
        <Card>
          <div className="flex min-w-0 items-center gap-3.5">
            <BrandMark
              name={job.brand_name ?? job.title}
              logo={brandLogo({
                logo_key: job.brand_logo_key,
                logo_url: job.brand_logo_url,
              })}
              size="md"
            />
            <div className="min-w-0 flex-1">
              {job.brand_name && (
                <p className="truncate text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
                  {job.brand_name}
                </p>
              )}
              <h1 className="truncate text-[21px] font-extrabold tracking-[-0.02em]">
                {job.title}
              </h1>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-ink-50">
            <span className="rounded-pill bg-shell px-3 py-1 font-semibold text-ink-70">
              {job.video_count} video{job.video_count === 1 ? "" : "s"}
            </span>
            <span className="rounded-pill bg-shell px-3 py-1 font-semibold text-ink-70">
              {kind}
            </span>
            {job.is_rush && (
              <span className="rounded-pill bg-ember px-3 py-1 font-semibold text-flame-dark">
                rush
              </span>
            )}
            {job.due_at && <span>due {shortDate(job.due_at)}</span>}
            {room.label && <span>for {room.label}</span>}
          </div>

          {everything.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <p className="min-w-0 flex-1 text-[13px] leading-[1.6] text-ink-50">
                {everything.length} files on this page, videos and assets
                together. links last an hour, reload for fresh ones.
              </p>
              <DownloadAll files={everything} />
            </div>
          )}

          {room.closed && (
            <p className="mt-4 rounded-card border border-line bg-shell px-4 py-3 text-[13.5px] leading-[1.6] text-ink-50">
              this batch is finished. the files are still here to look at,
              nothing is waiting on you.
            </p>
          )}
          {!room.closed && room.delivered && (
            <p className="mt-4 rounded-card border border-line bg-ember px-4 py-3 text-[13.5px] leading-[1.6] text-flame-dark">
              a cut has been filed against this batch already. check with whoever
              sent you the link before you start.
            </p>
          )}
          {room.unsigned && (
            <p className="mt-4 rounded-card border border-line bg-shell px-4 py-3 text-[13.5px] leading-[1.6] text-ink-50">
              the uploaded files are not coming through right now. ask whoever
              sent this link to send them another way.
            </p>
          )}
        </Card>

        {/* ------------------------------------------------------ the brief */}
        <Card className="space-y-4">
          <p className={LABEL}>The brief</p>
          {job.brief ? (
            <p className="whitespace-pre-wrap text-[15px] leading-[1.7] text-ink-70">
              {job.brief}
            </p>
          ) : (
            <p className="text-[14px] text-ink-50">
              nothing written. the title is the whole ask.
            </p>
          )}

          {(job.style || job.format) && (
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              {job.style && (
                <div>
                  <p className={LABEL}>Style</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.6] text-ink-70">
                    {job.style}
                  </p>
                </div>
              )}
              {job.format && (
                <div>
                  <p className={LABEL}>Format</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.6] text-ink-70">
                    {job.format}
                  </p>
                </div>
              )}
            </div>
          )}

          {(job.footage_links.length > 0 || job.reference_links.length > 0) && (
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Links label="Video links" items={job.footage_links} />
              <Links label="References" items={job.reference_links} />
            </div>
          )}
        </Card>

        {/* ------------------------------------------------- the raw footage */}
        <Card className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={LABEL}>The videos to cut</p>
            {room.footage.length > 0 ? (
              <DownloadAll files={saveable(room.footage)} />
            ) : (
              <p className="text-[12.5px] text-ink-50">nothing uploaded</p>
            )}
          </div>

          {room.footage.length === 0 ? (
            <p className="text-[14px] leading-[1.6] text-ink-50">
              no files here. the raw footage is on one of the links above, or it
              is coming separately.
            </p>
          ) : (
            <div className="space-y-3">
              {room.footage.map((file) => (
                <Clip key={file.id} file={file} />
              ))}
            </div>
          )}
        </Card>

        {/* -------------------------------------------- everything on top */}
        {hasSide && (
          <Card className="space-y-5">
            {room.assets.length > 0 && (
              <div>
                <p className={LABEL}>Assets</p>
                <p className="mt-1 text-[12.5px] text-ink-50">
                  b roll, music, sfx, product shots, logos.
                </p>
                <ul className="mt-3 space-y-3">
                  {room.assets.map((file) => (
                    <FileRow key={file.id} file={file} />
                  ))}
                </ul>
              </div>
            )}

            {room.docs.length > 0 && (
              <div className={room.assets.length > 0 ? "border-t border-line pt-5" : ""}>
                <p className={LABEL}>Read first</p>
                <ul className="mt-3 space-y-3">
                  {room.docs.map((file) => (
                    <FileRow key={file.id} file={file} />
                  ))}
                </ul>
              </div>
            )}

            {hasShelf && (
              <div
                className={
                  room.assets.length > 0 || room.docs.length > 0
                    ? "border-t border-line pt-5"
                    : ""
                }
              >
                <p className={LABEL}>From the brand</p>
                <p className="mt-1 text-[12.5px] text-ink-50">
                  kept once for {job.brand_name ?? "this brand"} and on every
                  batch for it.
                </p>
                <ul className="mt-3 space-y-3">
                  {room.shelf.map((file) => (
                    <FileRow key={file.id} file={file} />
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {/* ---------------------------------------------------- the handback */}
        {!room.closed && (
          <Card>
            <p className={LABEL}>When you are done</p>
            <p className="mt-1.5 text-[14px] leading-[1.65] text-ink-70">
              send the finished cut back to whoever sent you this link, the same
              way you always do. there is nothing to upload here.
            </p>
          </Card>
        )}
      </div>

      <Footer />
    </Shell>
  );
}
