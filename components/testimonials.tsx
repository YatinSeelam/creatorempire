import Image from "next/image";
import { testimonials } from "@/lib/content";
import type { ShotTestimonial, VideoTestimonial } from "@/lib/content";
import { Section, SectionHeading } from "./section";

/**
 * Proof, and the only band that argues nothing of its own — the screenshots do
 * the arguing. It sits straight after the two plan cards, so the offer is
 * followed by people saying it happened.
 *
 * One column, not a grid. These are screenshots of text: two columns halves the
 * width, which halves the type, and a testimonial nobody can read is decoration.
 * The column is capped at 860px for the same reason the shots are on ink cards —
 * the sources are all dark-mode apps, so a white card would frame them with a
 * seam the screenshots do not have.
 */
export function Testimonials() {
  return (
    <Section id="reviews">
      <SectionHeading
        title={testimonials.title}
        sub={testimonials.sub}
      />

      <div className="mx-auto mt-10 flex max-w-[860px] flex-col gap-4 sm:mt-12 sm:gap-5">
        {testimonials.shots.map((shot) => (
          <Shot key={shot.src} shot={shot} />
        ))}
      </div>

      <VideoWall />
    </Section>
  );
}

function Shot({ shot }: { shot: ShotTestimonial }) {
  return (
    <figure
      className={`rounded-card bg-ink p-2 sm:p-3 ${
        shot.narrow ? "mx-auto w-full max-w-[420px]" : ""
      }`}
    >
      <Image
        src={shot.src}
        alt={shot.alt}
        width={shot.w}
        height={shot.h}
        sizes="(min-width: 900px) 860px, 100vw"
        className="h-auto w-full rounded-[10px]"
      />
      <Caption name={shot.name} source={shot.source} />
    </figure>
  );
}

/** Renders nothing until there is a video to show. An empty slot with "coming
 *  soon" in it is a worse ad for the product than no slot at all. */
function VideoWall() {
  if (testimonials.videos.length === 0) return null;

  return (
    <div className="mx-auto mt-12 w-full max-w-[860px] sm:mt-14">
      <h3 className="text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-flame">
        {testimonials.videoTitle}
      </h3>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {testimonials.videos.map((video) => (
          <Clip key={video.src} video={video} />
        ))}
      </div>
    </div>
  );
}

function Clip({ video }: { video: VideoTestimonial }) {
  return (
    <figure className="rounded-card bg-ink p-2">
      {/* preload="metadata" so three clips cost three headers, not three files */}
      <video
        className="aspect-[9/16] w-full rounded-[10px] bg-black object-cover"
        controls
        playsInline
        preload="metadata"
        poster={video.poster}
      >
        <source src={video.src} type="video/mp4" />
      </video>
      <Caption name={video.name} source={video.source} />
    </figure>
  );
}

function Caption({ name, source }: { name: string; source: string }) {
  return (
    <figcaption className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-3 sm:px-2">
      <span className="text-[13.5px] font-semibold text-white/85">{name}</span>
      <span className="rounded-pill border border-white/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/45">
        {source}
      </span>
    </figcaption>
  );
}
