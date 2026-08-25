"use client";

import { useState } from "react";

/**
 * The creator's word on an editor, as one tap.
 *
 * It replaced a <select> because rating was the one thing on the approve panel
 * nobody did: a dropdown reads as a required field with a "skip" option in it,
 * so the cheapest move was always to leave it alone. Stars are a target you hit
 * on the way past the approve button.
 *
 * It writes into hidden inputs rather than posting anything itself, so the
 * approve action keeps reading `rating` and `rating_note` exactly as before and
 * a rating is still optional: no stars means an empty `rating`, which the action
 * already treats as skip.
 */

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Only offered under 4. A creator who liked the cut has nothing to file, and
 * asking them anyway is what turns a one-tap rating back into a form.
 */
const TAGS = ["missed the brief", "slow", "captions", "wrong format", "pacing"];

const WORD: Record<number, string> = {
  1: "bad",
  2: "rough",
  3: "fine",
  4: "good",
  5: "great",
};

export function RatingInput() {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);

  // tapping the chosen star again clears it. without a way back out, a stray
  // tap is a rating on somebody's record that the creator never meant to leave.
  const pick = (n: number) => {
    const next = rating === n ? 0 : n;
    setRating(next);
    if (next === 0 || next > 3) setTags([]);
  };

  const toggle = (tag: string) =>
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    );

  return (
    <div>
      <input type="hidden" name="rating" value={rating || ""} />
      <input type="hidden" name="rating_note" value={tags.join(", ")} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13.5px] text-ink-50">Rate the editor</span>
        <div className="flex items-center gap-1">
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => pick(n)}
              aria-label={`${n} out of 5`}
              aria-pressed={rating === n}
              className={`rounded-pill p-1 transition-colors ${
                n <= rating ? "text-flame" : "text-line hover:text-ink-50"
              }`}
            >
              <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
                <path
                  d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z"
                  fill="currentColor"
                />
              </svg>
            </button>
          ))}
        </div>
        <span className="text-[13px] text-ink-50">
          {rating ? WORD[rating] : "optional, tap to skip"}
        </span>
      </div>

      {rating > 0 && rating <= 3 && (
        <div className="mt-3">
          <p className="text-[13px] text-ink-50">What went wrong?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TAGS.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggle(tag)}
                  aria-pressed={on}
                  className={`rounded-pill px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    on
                      ? "bg-flame text-on-accent"
                      : "border border-line text-ink-70 hover:text-ink"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
