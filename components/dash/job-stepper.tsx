/**
 * Where a batch is, as one line.
 *
 * It was four circled marks on a rail spanning the whole page, each with a
 * label and a date under it — sixty pixels of chrome to say a thing that is
 * one short sentence, and three quarters of it about steps already behind you.
 *
 * So: four squares, and words only for the step you are actually on. A done
 * step is a filled square, the current one is a filled square with the sentence
 * beside it, a step not reached is hollow. Nothing is centred, nothing is
 * circled, and the whole strip is the height of the text in it.
 *
 * Server component.
 */

export type StepState = "done" | "now" | "todo";

export type Step = {
  label: string;
  state: StepState;
  /** what is being waited on, or the date it happened. one short line. */
  note?: string;
};

export function JobStepper({ steps }: { steps: Step[] }) {
  // the sentence is the current step's, or the last one's on a finished job.
  const here = steps.find((s) => s.state === "now") ?? steps[steps.length - 1];
  const at = steps.filter((s) => s.state === "done").length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <ol className="flex shrink-0 items-center gap-1" aria-label={`step ${at + 1} of ${steps.length}`}>
        {steps.map((step) => (
          <li
            key={step.label}
            title={step.label}
            aria-current={step.state === "now" ? "step" : undefined}
            className={`h-[3px] w-7 ${
              step.state === "todo" ? "bg-line" : "bg-ink"
            }`}
          />
        ))}
      </ol>

      <p className="min-w-0 text-[12.5px]">
        <span className="font-bold tracking-[-0.01em]">{here?.label}</span>
        {here?.note && <span className="text-ink-50"> · {here.note}</span>}
      </p>
    </div>
  );
}
