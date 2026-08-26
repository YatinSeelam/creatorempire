"use client";

import { useState } from "react";

/**
 * Pull the whole batch down in one gesture.
 *
 * There is no zip. Zipping would mean a server that reads every object and
 * streams a new one, which is real money and real memory for a thing the
 * browser can already do: each url carries `content-disposition: attachment`,
 * so an anchor click saves the file instead of navigating.
 *
 * They go one at a time with a gap. Firing nine downloads in the same tick is
 * what makes a browser decide the page is hostile and drop most of them; a few
 * hundred milliseconds apart, they all land. Chrome asks once whether the site
 * may download multiple files, which is why the button says what it is about to
 * do rather than just doing it.
 */
export function DownloadAll({
  files,
}: {
  files: { name: string; url: string }[];
}) {
  const [going, setGoing] = useState(false);
  const [done, setDone] = useState(0);

  if (files.length < 2) return null;

  const run = async () => {
    setGoing(true);
    setDone(0);
    for (const [i, file] of files.entries()) {
      const a = document.createElement("a");
      a.href = file.url;
      // cross origin, so this attribute is advisory only: the disposition
      // header on the signed url is what actually names the saved file.
      a.download = file.name;
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDone(i + 1);
      if (i < files.length - 1) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    setGoing(false);
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={going}
      className="shrink-0 rounded-pill border border-line px-4 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-60"
    >
      {going ? `saving ${done}/${files.length}` : `download all ${files.length}`}
    </button>
  );
}
