import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/base-path";

const nextConfig: NextConfig = {
  // this repo sits inside a bigger folder, so pin the root or turbopack walks up
  // and picks the wrong lockfile
  turbopack: { root: __dirname },

  // production serves this app at www.ugcflows.com/creatorempire, behind a
  // rewrite on the ugc flows deploy. BASE_PATH is the path half of
  // NEXT_PUBLIC_SITE_URL, so the same build script produces the prefixed app in
  // vercel and the bare one on localhost. assetPrefix is left alone on purpose:
  // next already sets it to basePath when it is empty.
  basePath: BASE_PATH,

  // @napi-rs/canvas ships a native .node binding and ffmpeg-static ships a
  // binary. Bundling either means the compiler parsing a binary and failing the
  // whole build, so both stay runtime requires.
  serverExternalPackages: ["@napi-rs/canvas", "ffmpeg-static"],

  // None of what the render worker needs is a plain import the file tracer can
  // follow: it spawns a binary by path, reads fonts off disk, and loads the
  // canvas binding through a require() matrix that resolves to a
  // platform-specific sibling package. Without this the route deploys and then
  // fails on the first render with a missing file nobody can see locally.
  outputFileTracingIncludes: {
    "/api/variations/process": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-*/**",
      "./public/fonts/**",
    ],
    // the brand bank page runs ffmpeg too, in its server actions rather than in
    // the worker: a sound off a pasted link is stripped there, and a clip
    // imported from drive has its poster cut there. a server action is served
    // by its own page's function, so the binary has to be in that function as
    // well or the action fails in production and only in production.
    "/tools/variations/**": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
