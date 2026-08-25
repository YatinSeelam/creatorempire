import { Crumbs, DashBar, Page } from "@/components/dash/ui";
import { NewDealForm } from "@/components/dash/deal-forms";
import { brandLogo } from "@/lib/brand-catalog";
import { loadBrands } from "@/lib/deals-server";

export default async function NewDealPage() {
  // the logo is resolved here rather than in the picker, so the browser is
  // handed a path and never has to re-derive one.
  //
  // no connected-account chips here any more. an Upload-Post profile is one row
  // per (creator, deal) since autoposting went per brand, so a deal that does
  // not exist yet cannot have connections to offer — the old unscoped read was
  // returning another brand's handles at best and an error at worst. accounts
  // attach on the deal's own connect section once it exists.
  const allBrands = await loadBrands();
  const brands = allBrands.map((b) => ({
    id: b.id,
    name: b.name,
    logo: brandLogo(b),
  }));

  return (
    <>
      <DashBar
        lead={
          <Crumbs
            size="lg"
            trail={[{ label: "Deals", href: "/deals" }, { label: "New deal" }]}
          />
        }
      />

      <Page fill>
        {/* the wizard carries its own progress header, so the page stays bare:
            one card, one walk through it.

            no max-width of its own. the wizard splits into a 280px explainer
            beside its fields at lg, and that split is measured against the
            viewport, not this box, so a narrower card did not stop it firing.
            it just left the fields two columns inside 300px while a third of
            the screen sat empty. the page's own 1040px column is the cap. */}
        {/* the card is measured to the wizard inside it. the page's own column
            is 1040px, which a four field step cannot fill, so a full width
            card put a 180px gutter down each side of the fields and called it
            layout. capped here, the empty space is outside the card where it
            reads as margin rather than inside it where it reads as a mistake. */}
        {/* from lg up the card is the frame: `Page fill` makes the shell exactly
            one viewport tall, and `max-h-full` here means the card can never
            grow past it. that is what stops opening the dates fold, or turning
            the bonus on, from putting a second scrollbar on the window under a
            step that already scrolls its own fields. below lg it is a plain
            block and the page scrolls, because a phone cannot fit any of this
            at any height. */}
        <div className="mx-auto w-full max-w-[820px] rounded-card border border-line bg-paper p-6 sm:p-8 lg:flex lg:max-h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
          <NewDealForm brands={brands} />
        </div>
      </Page>
    </>
  );
}
