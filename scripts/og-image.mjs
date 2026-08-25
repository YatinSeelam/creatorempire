// Renders public/og.png, the 1200x630 link preview card, from the offer.
//
//   node scripts/og-image.mjs
//
// Run it again whenever the headline, the price or the deal floor changes and
// commit the png. It is a static file on purpose: app/opengraph-image.tsx
// (next/og at request time) rendered fine standalone but died inside the dev
// server on node 20 with a masked error, and a preview card is not worth a
// route that can take the build down. This is the same satori renderer, run
// once here, with the same Inter the site already ships for the variations
// worker.
import { readFile, writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og.js";

const price = "$500";
const dealLabel = "$750 or more";
const domain = "ugcflows.com";
const wordmark = "ugcflows";

const h = (type, props, ...children) => ({
  type,
  props: { ...props, children: children.length === 1 ? children[0] : children },
});

const inter = await readFile(new URL("../public/fonts/Inter-Bold.ttf", import.meta.url));

const line = (text, color) =>
  h(
    "div",
    { style: { fontSize: 78, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3, color } },
    text
  );

const tree = h(
  "div",
  {
    style: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "64px 72px",
      background: "#ffffff",
      backgroundImage:
        "linear-gradient(#efece6 1px, transparent 1px), linear-gradient(90deg, #efece6 1px, transparent 1px)",
      backgroundSize: "48px 48px",
      fontFamily: "Inter",
      color: "#101010",
    },
  },
  h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 18 } },
    h(
      "div",
      {
        style: {
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "#101010",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 34,
          fontWeight: 700,
        },
      },
      "u."
    ),
    h("div", { style: { fontSize: 34, fontWeight: 700, letterSpacing: -1 } }, wordmark)
  ),
  h(
    "div",
    { style: { display: "flex", flexDirection: "column" } },
    line("Land brand deals in", "#101010"),
    line("your first 30 days.", "#101010"),
    line(`Or your ${price} back.`, "#ec5a29")
  ),
  h(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 26,
        color: "#5b5b5b",
      },
    },
    h("div", {}, `${price} a month. One placed deal pays ${dealLabel}.`),
    h("div", { style: { color: "#101010", fontWeight: 700 } }, domain)
  )
);

const res = new ImageResponse(tree, {
  width: 1200,
  height: 630,
  fonts: [{ name: "Inter", data: inter, weight: 700, style: "normal" }],
});
const png = Buffer.from(await res.arrayBuffer());
const out = new URL("../public/og.png", import.meta.url);
await writeFile(out, png);
console.log(`wrote public/og.png (${png.length} bytes)`);
