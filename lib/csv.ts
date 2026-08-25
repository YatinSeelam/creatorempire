/**
 * The csv toolkit every export route shares. Extracted from the deal export,
 * which wrote the rules first: utf-8 BOM for Excel, one line per row, every
 * cell defused against formula injection, and no caching because an export is
 * a snapshot of numbers that move every night.
 */

/**
 * What makes Excel read the file as utf-8 rather than latin-1, which is the
 * difference between a caption's emoji and four bytes of mojibake. Written as a
 * code point rather than the character itself: as a literal it is invisible in
 * the source and the first person to tidy the file deletes it without knowing.
 */
export const BOM = String.fromCharCode(0xfeff);

/** Cents to a plain decimal. No currency symbol: this column gets summed. */
export const usd = (cents: number) => (cents / 100).toFixed(2);

/** Captions arrive with newlines in them, and a newline is a row break here. */
export const oneLine = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim();

/**
 * One cell, quoted if it has to be and defused if it could be a formula.
 *
 * Captions and handles are scraped off tiktok and instagram, which means a
 * stranger picks their contents. A caption starting `=` or `@` is a live formula
 * the moment this file is opened in Excel or Sheets, and the interesting ones
 * reach the network. A leading apostrophe is what those two read as "this is
 * text", and it is not shown in the cell.
 *
 * The numeric escape hatch matters: `-12.00` starts with a dangerous character
 * and is also a number this file exists to add up, so anything that is only
 * digits is left exactly as it is.
 */
export const cell = (value: string | number | null | undefined) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const fileSlug = (value: string, fallback = "export") =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || fallback;

/** One row: cells in, a defused csv line out. */
export const row = (cells: (string | number | null | undefined)[]) =>
  cells.map(cell).join(",");

/** The response every export returns. `lines[0]` is the header row. */
export function csvResponse(filename: string, lines: string[]): Response {
  return new Response(BOM + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
