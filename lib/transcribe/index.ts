/**
 * Paste a link, get the script out of it.
 *
 * The pipeline is three steps and only the middle one costs anything worth
 * thinking about: parse the url, scrape the post, and transcribe the audio if
 * the platform did not already hand over words.
 *
 * Deepgram is given the mp4 url rather than the bytes. We never download the
 * video, deepgram fetches it itself, which is why lib/transcribe/sources.ts
 * works so hard to return a url a third party can actually read.
 *
 * Every failure comes back as a sentence, not an exception. A creator pasting a
 * private reel needs to know it was private, and a stack trace is not that.
 */

import { hasApifyToken } from "@/lib/apify";
import type { Who } from "./media";
import { fetchPost, parseAnyPostUrl, type ScrapedPost } from "./sources";

const DEEPGRAM =
  "https://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&smart_format=true&language=en";

// A 90 second reel takes deepgram 30 to 80 seconds end to end, fetch included.
// 60 was too tight and aborted clips that were about to succeed.
const DEEPGRAM_TIMEOUT_MS = 90_000;

export type TranscribeResult =
  | { ok: true; post: ScrapedPost; title: string; transcript: string }
  | { ok: false; error: string };

/** One sentence per line, blank line between, so it reads as a script. */
export function spaceOutSentences(input: string): string {
  const text = input.trim();
  if (!text) return "";
  return text
    .split(/(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** The first line of the caption, which is what a creator recognises the clip by. */
function makeTitle(caption: string | null): string {
  const first = (caption ?? "").trim().split("\n")[0]?.trim();
  if (!first) return "untitled video";
  return first.length > 110 ? `${first.slice(0, 110)}...` : first;
}

export async function scrapeAndTranscribe(
  rawUrl: string,
  who: Who | null = null
): Promise<TranscribeResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, error: "paste a tiktok, instagram or youtube link to start." };

  const parsed = await parseAnyPostUrl(url);
  if (!parsed) {
    return { ok: false, error: "that link is not a tiktok, instagram or youtube video." };
  }
  if (parsed.platform !== "youtube" && !process.env.RAPIDAPI_KEY && !hasApifyToken()) {
    return {
      ok: false,
      error: "scraping is not set up on this server yet (RAPIDAPI_KEY or APIFY_API_KEY).",
    };
  }

  const post = await fetchPost(parsed, who);
  if (!post) {
    return {
      ok: false,
      error:
        parsed.platform === "facebook" && !hasApifyToken()
          ? "facebook isn't supported by the transcriber yet. paste a tiktok, instagram or youtube link instead."
          : "could not read that one. it is usually private, deleted or region locked.",
    };
  }

  // the post read fine, there was just nothing said in it. saying "private,
  // deleted or region locked" here sent people back to check a link that was
  // never the problem.
  if (post.silent) {
    return {
      ok: false,
      error:
        post.platform === "youtube"
          ? "this video has captions turned off, so there is nothing to pull."
          : "nobody talks in that one, so there is nothing to write down.",
    };
  }

  let transcript = post.transcript ?? "";

  if (!transcript && post.video_url) {
    if (!process.env.DEEPGRAM_API_KEY) {
      return { ok: false, error: "transcription is not set up on this server yet (DEEPGRAM_API_KEY)." };
    }
    try {
      transcript = await deepgram(post.video_url);
    } catch (err) {
      console.error("[transcribe.deepgram_failed]", err);
      return { ok: false, error: "the video came through but transcription failed. try it again." };
    }
  }

  // youtube with captions off lands here: real metadata, no words and no mp4 to
  // send anywhere. Say that rather than saving a card with an empty pane.
  if (!transcript.trim() && !post.video_url) {
    return {
      ok: false,
      error:
        post.platform === "youtube"
          ? "this video has captions turned off, so there is nothing to pull."
          : "no audio came back for this one, so there is nothing to transcribe.",
    };
  }

  // A provider can answer successfully with an empty shell. Saving that gives a
  // creator a dead tile they can only delete.
  if (!transcript.trim() && !post.thumbnail_url) {
    return { ok: false, error: "that came back empty. check the link opens for you, then retry." };
  }

  return {
    ok: true,
    post,
    // the apify path has no caption source for instagram/facebook, so a card
    // is named off its own first words rather than saved as "untitled video".
    title: makeTitle(post.caption ?? transcript),
    transcript: spaceOutSentences(transcript),
  };
}

async function deepgram(audioUrl: string): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");

  const res = await fetch(DEEPGRAM, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: audioUrl }),
    signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`deepgram ${res.status}: ${body.slice(0, 200) || "no body"}`);
  }

  const json = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}
