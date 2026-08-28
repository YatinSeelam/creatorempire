"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteDealAsset, recordDealAsset } from "@/app/(dash)/deals/actions";
import { Dropzone } from "@/components/dropzone";
import { fileFamily, humanSize, type DealAsset } from "@/lib/editing-files";

/**
 * The brand deal's shelf: the files every batch for this brand needs.
 *
 * Two kinds and they are genuinely different jobs. A `doc` is what the editor
 * reads before cutting — the SOP, the brand guidelines, the standing brief that
 * would otherwise be retyped into the brief box every single time. An `asset`
 * is what goes on top of the cut — the logo, the product shots, the music bed,
 * the sfx pack.
 *
 * Nothing here is ever copied onto a job. A job carries the deal id and reads
 * this live, which is what makes replacing a wrong logo fix every future batch
 * instead of the next one only.
 *
 * The same panel is mounted on the deal page and inline on the new job form, so
 * "did I already upload the logo" is answerable on the screen where the
 * question comes up.
 */
export function DealShelf({
  dealId,
  assets,
}: {
  dealId: string;
  assets: DealAsset[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"doc" | "asset">("doc");

  const docs = assets.filter((a) => a.kind === "doc");
  const material = assets.filter((a) => a.kind === "asset");

  async function remove(asset: DealAsset) {
    const body = new FormData();
    body.set("asset_id", asset.id);
    await deleteDealAsset(body);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["doc", "Docs the editor reads"],
            ["asset", "Assets that go on the cut"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setKind(value)}
            aria-pressed={kind === value}
            className={`rounded-pill border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              kind === value
                ? "border-flame bg-ember text-flame-dark"
                : "border-line text-ink-50 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Dropzone
        folder={`bank/${dealId}`}
        label={kind === "doc" ? "Drop the docs" : "Drop the assets"}
        hint={
          kind === "doc"
            ? "The SOP, the brand guidelines, the standing script. Every batch for this brand shows these."
            : "Logos, product shots, music, sfx. Uploaded once, on every batch for this brand."
        }
        accept={kind === "doc" ? undefined : "image/*,audio/*,video/*"}
        onUploaded={(file) => recordDealAsset({ dealId, kind, ...file })}
        onDone={() => router.refresh()}
      />

      <ShelfGroup
        title="Docs"
        empty="No standing doc yet. Anything here is the first thing an editor opens."
        items={docs}
        onRemove={remove}
      />
      <ShelfGroup
        title="Assets"
        empty="Nothing on the shelf yet."
        items={material}
        onRemove={remove}
      />
    </div>
  );
}

function ShelfGroup({
  title,
  empty,
  items,
  onRemove,
}: {
  title: string;
  empty: string;
  items: DealAsset[];
  onRemove: (asset: DealAsset) => void;
}) {
  return (
    <div>
      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[13px] text-ink-50">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {items.map((asset) => (
            <li key={asset.id} className="flex min-w-0 items-baseline gap-2 text-[13.5px]">
              <span className="shrink-0 text-[12.5px] text-ink-50">{fileFamily(asset)}</span>
              {asset.signedUrl ? (
                <a
                  href={asset.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-semibold underline decoration-line underline-offset-2 transition-colors hover:text-flame-dark"
                >
                  {asset.name}
                </a>
              ) : (
                <span className="truncate font-semibold">{asset.name}</span>
              )}
              <span className="shrink-0 text-[12.5px] text-ink-50">
                {humanSize(asset.size_bytes)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(asset)}
                className="ml-auto shrink-0 text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
