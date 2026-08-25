// Every word and number on the landing page lives here. Change the offer, the
// numbers or the headline in this file and the page follows.
//
// Writing rule for this file: short sentences, common words, one idea per
// sentence. Target a 5th grade reading level. If a line needs a comma to hold
// two clauses together, it is usually two sentences.


export const brand = {
  name: "Creator Empire",
  wordmark: "creator empire",
  tagline: "Better paying brand deals, and the system that runs all of them.",
  // the live domain. name, wordmark and domain all carry the s now — there is
  // no spelling of this product without it. read from here rather than typed
  // out, so a portfolio link and an email address can never disagree.
  domain: "creatorempire.app",
  // the one address on the site. support, privacy requests and legal questions
  // all land here, so it is written down once and read from everywhere.
  contactEmail: "hello@creatorempire.app",
  // one label, used by every button on the page. more than one label makes
  // people think the buttons do different things.
  ctaLabel: "Get Creator Empire",
};

export const pricing = {
  price: "$500",
  period: "/mo",
  // where every buy button on the marketing pages goes. it is a route, not a
  // page: it decides between the door, stripe and the dashboard on the server,
  // so a signed-in reader never meets a signup form and a paying one never
  // meets a price. see app/checkout/route.ts.
  startUrl: "/checkout",
  // the door itself. still the honest url for json-ld and for the "new here?"
  // link under the sign-in form, both of which want a page a stranger can read.
  signupUrl: "/sign-up",
  // the stripe payment link. paste it here, or set NEXT_PUBLIC_CHECKOUT_URL in
  // vercel to change it without a deploy of your own. an http link opens in a
  // new tab; until one is set every cta scrolls to the price instead.
  checkoutUrl:
    process.env.NEXT_PUBLIC_CHECKOUT_URL ||
    "https://buy.stripe.com/3cIaEY0FJf0Cffia4L4F200",
  // No "cancel any time" anywhere on this page. This is a commitment, and the
  // guarantee (make back your $500 in 30 days or it comes back) is the real
  // risk reversal. It is also stronger than a cancel link, so nothing is lost.
  terms: "No setup fee. Billed monthly.",
};

// What we say placed brand work pays. It shows up in the hero, the plans and
// the faq, so change it here and it changes everywhere.
//
// This is a FLOOR, not a range. It used to read "$750 to $1,000", which quietly
// capped the offer at a thousand — the top end is not ours to cap, and quoting
// one made the good case sound like the best case.
//
// Declared above `plans` on purpose: `plans` reads it at module load, and a
// const cannot be read before its own line runs.
export const dealRate = {
  min: "$750",
  value: 750,
  label: "$750 or more",
};

// The first group's cap, and how full it is. `taken` is bumped by hand as
// sales land. The hero meter and the offer card both read from here, so the
// two can never show different numbers. Not its own section on the page on
// purpose: scarcity is a line next to the button, not a band of its own.
export const capacity = {
  cap: 30,
  taken: 15,
  spotsLabel: (taken: number, cap: number) => `${taken} of ${cap} spots taken`,
  why: "We place deals by hand. So the first group stops at 30 creators.",
  proof: "Everyone in so far has made back more than they paid.",
};

// ---------------------------------------------------------------------------
// THE OFFER
//
// One plan, one price, one promise. Pro is gone: two cards made the reader pick
// a tier before they had decided to buy anything, and the money-first promise
// only works if there is exactly one number to make back.
//
// The page sells the OUTCOME (make more from UGC, spend less time running it).
// Systems and tools are the mechanism, and the mechanism never goes above the
// promise on the page.
// ---------------------------------------------------------------------------

export type Plan = {
  id: "starter";
  name: string;
  price: string;
  period: string;
  who: string;
  pitch: string;
  featured: boolean;
  features: string[];
  foot: string;
  cta: string;
  checkoutUrl: string;
};

export const plans: Plan[] = [
  {
    id: "starter",
    name: "Creator Empire",
    price: "$500",
    period: "/mo",
    who: "For working creators",
    pitch: "Better paying deals, plus the system that runs all of them for you.",
    featured: false,
    features: [
      "Brand deals placed for you",
      "A placement call every 2 weeks",
      "1 group call a week, plus the creator room",
      "The app: deals, money, posting, portfolio",
      "30 editor credits a month, cuts from $1",
      "The tools that kill the admin half of the job",
    ],
    foot: `One deal pays ${dealRate.min}. That is your ${pricing.price} back, and more.`,
    cta: "Get Creator Empire",
    checkoutUrl:
      process.env.NEXT_PUBLIC_CHECKOUT_URL ||
      "https://buy.stripe.com/3cIaEY0FJf0Cffia4L4F200",
  },
];

export const planById = (id?: string | null): Plan =>
  plans.find((p) => p.id === id) ?? plans[0];

// ---------------------------------------------------------------------------
// THE FOUR CORE OFFERS
//
// Three rules now, and the first one replaced the rule this section used to
// run on ("answer every faq question in the block it belongs to"). That rule is
// what grew the blocks to nine bullets each and made the band a wall.
//
// 1. ONE LEDE AND EXACTLY FOUR POINTS PER OFFER, and every one of them fits on
//    a single line at the block's width (roughly 50 characters). Four blocks
//    with 4/3/8/9 points render as four cards of four different heights stacked
//    down one column, which reads as broken layout rather than as varied
//    content. If a fifth thing is worth saying it goes in the faq, or it
//    replaces one of the four.
// 2. Short sentences. One idea each. If a line needs a comma to hold two
//    clauses together it is two sentences.
// 3. The lede is ONE sentence and it is the offer in a breath. It is not a
//    summary of the four points under it — a paragraph that restates its own
//    bullets is the thing that grew this section into a wall the first time.
//
// `image.src` is null on all four today and each block falls back to a drawing
// of the real screen (components/core-offers.tsx). To use a real screenshot or
// an ai render, drop the file in /public/offer/ and set src plus alt. The page
// is never blank in between.
// ---------------------------------------------------------------------------

export type CoreOffer = {
  key: string;
  index: string;
  label: string;
  title: string;
  /** one line, for the four-up grid that opens the band. */
  short: string;
  /** one sentence, the offer in a breath. see the rules above. */
  lede: string;
  /** exactly four, each one line long. see the rules above. */
  points: string[];
  value: string;
  image: { src: string | null; alt: string; hint: string };
  soon?: boolean;
};

export const whatYouGet = {
  eyebrow: "What you get",
  title: "Four things. That is all of it.",
  // no lede. the four cards under this heading are the lede.
  ctaNote: "All four for $500 a month.",
};

export const coreOffers: CoreOffer[] = [
  {
    key: "deals",
    index: "01",
    label: "Brand deals",
    title: "We get you the deals",
    short: `A call every 2 weeks. Every deal pays ${dealRate.min} or more.`,
    lede: "Brands come to us. We hand you the job and take none of the money.",
    points: [
      "We match you to a brand and hand you the job.",
      `Every deal pays ${dealRate.min} or more. You keep all of it.`,
      "Rate and brief are agreed before you film.",
      "A call every 2 weeks lines up what you film next.",
    ],
    // three deals at our own floor, plus the calls that place them
    value: "$3,300",
    image: {
      src: null,
      alt: "A placed brand deal, with its rate and brief attached",
      hint: "deals: a deal card, the rate, the booked call",
    },
  },
  {
    key: "dashboard",
    index: "02",
    label: "Dashboard and tools",
    title: "One app runs the money",
    short: "Every deal, view and dollar in one place. Plus the tools.",
    lede: "One app holds every deal, every view and every dollar you are owed.",
    points: [
      "Pulls your view counts on its own. No spreadsheet.",
      "Works out your CPM and bonus pay, video by video.",
      "Writes your invoices. One per brand, per month.",
      "Auto poster, variations, portfolio, account inboxes.",
    ],
    // what the tracking and the tools cost separately
    value: "$1,200",
    image: {
      src: null,
      alt: "The Creator Empire dashboard, showing earnings, views and deals",
      hint: "dashboard: a real screenshot of /dashboard or /deals",
    },
  },
  {
    key: "community",
    index: "03",
    label: "Community and calls",
    title: "A room of creators. One call a week.",
    short: "30 creators. A group call every week. Real rates shared.",
    lede: "A room of 30 creators and one group call a week. Nothing to sit through.",
    points: [
      "One group call a week. Real rates, real briefs.",
      "Only 30 in the room. Small on purpose.",
      "People post what brands actually paid them.",
      "Ask at 11pm. Someone who ran that brand answers.",
    ],
    // four group calls a month at what one coaching call costs
    value: "$600",
    image: {
      src: null,
      alt: "The creator room and the weekly group call",
      hint: "community: the room, or a group call",
    },
  },
  {
    key: "editing",
    index: "04",
    label: "Editing system",
    title: "Editors cut your videos for $1 to $3",
    short: "$30 of credits free each month. Cuts back in 36 hours.",
    lede: "You film, an editor cuts, you approve. That is the whole loop.",
    points: [
      "$30 of edit credits free, every month.",
      "Cuts from $1. Back in 36 hours, every time.",
      "Revisions are free. Send it back as often as needed.",
      "Your brand can okay a cut on a link. No login.",
    ],
    // the free $30 plus what those cuts cost at a normal editor's rate
    value: "$900",
    image: {
      src: null,
      alt: "An edit job moving from posted to claimed to delivered",
      hint: "editing: the job board, or a job with its statuses",
    },
    // built and gated off (EDITING_ENABLED in lib/editing.ts).
    soon: true,
  },
];

// ---------------------------------------------------------------------------
// WHO THIS IS FOR
//
// The qualifier, between the goods and the price. It is the guarantee said the
// other way round: we can promise a creator who already films will land a deal
// in 30 days, and we cannot promise it to somebody learning on our clock. So we
// do not take them, and saying so out loud is what makes the promise readable
// instead of suspicious.
// ---------------------------------------------------------------------------

export const fit = {
  // the heading is one sentence broken over the eyebrow and the title, so the
  // band opens on the sentence itself rather than on a label above a sentence.
  // there is no lede under it any more: the reason we can promise what we
  // promise IS the two columns, and a line saying so was the third thing a
  // reader had to get through before reaching them.
  eyebrow: "We only take creators",
  title: "Who already film",
  forLabel: "This is you if",
  notLabel: "This is not you if",
  forList: [
    "You make UGC and brands have paid you for it",
    "You read a brief and hit the date",
    "You can film a batch inside a week",
    "You want better deals, not lessons",
  ],
  notList: [
    "You have never been paid for a UGC video",
    "You are looking for a course to watch",
    "You want someone else to film it",
    "You want the deals but will skip the calls",
  ],
};

// ---------------------------------------------------------------------------
// EVERYTHING YOU GET
//
// The stack. One line per thing, what it is worth on its own, the total, then
// the price under it.
//
// The values are not invented. Each one is what the same thing costs somewhere
// else, and `valueNote` on the core offer above says which: two deals at our
// own floor, what the tools cost alone, four coaching calls, the free credits
// plus 20 cuts at a normal editor's rate. If a number stops being defensible,
// cut it rather than round it up. A total a reader can check beats a bigger one
// they cannot.
// ---------------------------------------------------------------------------

export const offer = {
  eyebrow: "Everything included",
  // One row per thing: a two-word name, one line saying what it actually is,
  // and what that thing costs on its own. The name carries the scan and the
  // line under it carries the meaning — a single sentence per row did one or
  // the other, never both, and the rows that tried read as a paragraph with a
  // price stuck on the end.
  stack: [
    {
      title: "Brand deals",
      sub: `Placed for you. Each pays ${dealRate.min} or more.`,
      value: "$2,500",
      icon: "deals",
    },
    {
      title: "Bi-weekly calls",
      sub: "We fix the deals you already have.",
      value: "$800",
      icon: "calls",
    },
    {
      title: "Deal tracking",
      sub: "Track every deal, view and dollar.",
      value: "$500",
      icon: "dashboard",
    },
    {
      title: "Creator tools",
      sub: "Auto poster, variations, portfolio maker.",
      value: "$700",
      icon: "tools",
    },
    {
      title: "Creator community",
      sub: "Room of 30 creators. 4 group calls a month.",
      value: "$600",
      icon: "community",
    },
    {
      title: "Editing credits",
      sub: "$30 of edit credits free every month. Cuts from $1.",
      value: "$900",
      icon: "editor",
      soon: true,
    },
  ] as {
    title: string;
    sub: string;
    value: string;
    icon: string;
    soon?: boolean;
  }[],
  totalLabel: "Total value",
  total: "$6,000",
  priceLabel: "Your price",
  multiple: "12x",
  multipleLabel: "what you pay",
  soonLabel: "Soon",
};

// The risk reversal. This is the ONLY place the guarantee is stated in full
// outside the faq, so keep `promise` and `conditions` word for word with the
// faq answer and with section 5 of the terms. Checkout, the welcome email and
// support all have to be able to read the same sentence back.
//
// The conditions are one line, not a checklist. They still have to be there (a
// guarantee with no conditions means somebody pays, does nothing and asks for
// the money back) but a four-row card made the escape hatch look bigger than
// the promise.
// The five things a creator has to do to claim it, one per line. This is the
// source: `conditions` and `fine` below are joined out of it, so the list on
// the page and the sentence in the faq, the terms and the search snippet can
// never drift apart.
const guaranteeSteps = [
  "Do the setup. Show up to your calls.",
  "Take the deals. Film them on brief.",
  "Then email us in the 7 days after day 30.",
  "No hoops. No fighting with support.",
  "No store credit. Just your money back.",
];

export const guarantee = {
  title: "Land a deal in 30 days or get it all back",
  promise:
    "No brand deal in your first 30 days? Made less than the $500 you paid us? We give the $500 back.",
  // the record so far, and it is a claim we have to be able to show. update it
  // the first month it stops being true rather than leaving it up.
  proof: "100% so far. Everyone who did the work made their money back.",
  // The conditions, as a list rather than one long sentence. They still have to
  // be printed — a guarantee with no conditions is one somebody claims after
  // doing nothing — but a paragraph of them under the promise read as small
  // print, which is exactly what a risk reversal must not read as. As checks
  // beside the promise they read as a short list of things to do.
  //
  // These five lines are the same words as the faq answer and section 5 of the
  // terms. Change one and change all three: checkout, the welcome email and
  // support all have to be able to read the same sentence back.
  steps: guaranteeSteps,
  // The same five lines as one sentence each, for the places that need prose:
  // the faq answer, the schema.org offer in lib/seo.ts and the student page.
  // Derived rather than typed a second time, because the version somebody reads
  // on the landing page and the version a search result quotes back at them
  // have to be the same promise, and two copies of a promise is how they stop
  // being.
  conditions: guaranteeSteps.slice(0, 3).join(" "),
  fine: guaranteeSteps.slice(3).join(" "),
};

// There is no launch date and no countdown, as of 2026-08-22. The bar at the
// top of the page counted down to August 28 and every other surface repeated
// the date: the hero eyebrow, the sign-up sub, the account receipt, an faq
// answer. A clock is only worth its space while it is ticking, and the day
// after it lands it is a stale promise printed on every page.
//
// What replaced it is `capacity`: the seats are the scarcity now, and that is
// a fact that stays true instead of one that expires. components/promo-bar.tsx
// reads it. Do not put a date back on the page without deciding where it will
// say the date has passed.

// The last band on the page. It exists because the faq is the last thing a
// reader sees otherwise, and a page that ends on an unanswered question ends on
// a shrug. Same ask as everywhere else, in the same words.
export const finalCta = {
  title: "One deal pays for the month",
  sub: `All four for ${pricing.price} a month. No deal in 30 days and you get it all back.`,
  note: `${capacity.cap - capacity.taken} of ${capacity.cap} seats left.`,
  // The three ticks down the right of the closing card. They are the four core
  // offers said in three words each, not new claims. Anything that needs a
  // sentence to be true does not belong in a band whose whole job is the button.
  points: ["Deals placed for you", "The app that runs them", "The room and the calls"],
};

// Who to talk to when someone wants a human.
//
// Talha runs brand deals, so anything about a brand, a rate or a campaign goes
// to him. One place, because the account page, the dashboard and any future
// welcome email all have to name the same person.
//
// It is his phone, not a shared inbox — a number someone can text at 11pm and
// get a person. `dealsHref` is sms: rather than tel:, because the button says
// "Message" and nobody wants to be cold called. `dealsHandle` is the number in
// the shape a person reads it, and it is shown next to the button so the value
// survives on a desktop where neither sms: nor tel: does anything.
//
// E.164 in the href, formatted in the label. Both live here so they cannot
// drift.
export const support = {
  dealsName: "Talha",
  dealsHref: "sms:+17324704350",
  dealsHandle: "+1 (732) 470-4350",
};


// The signed-in confirmation page at /account. Two states, and the difference
// between them is the whole point of the page: before they pay it is one
// button, after they pay it is a receipt and a person to talk to.
//
// Same writing rule as the rest of this file, only harder — this page is read
// once, in a hurry, usually on a phone. Every line here has to survive being
// skimmed.
export const account = {
  unpaid: {
    badge: "One step left",
    title: "You're in",
    sub: "Pay and your seat is locked.",
    ctaNote: "Your dashboard opens the moment it clears.",
  },
  paid: {
    badge: "Paid",
    title: "You're all set",
    sub: "Your seat is locked and your dashboard is open.",
    receiptLabel: "Paid on",
    planLabel: "Your plan",
    // the row this replaced printed the launch date. it is the first row of the
    // receipt card, so it cannot simply be dropped: an empty card is worse than
    // a plain fact.
    accessLabel: "Dashboard access",
    accessValue: "Open now",
  },
  pastDue: {
    badge: "Card needs a look",
    body: "Your last payment did not go through. Your seat is still held while Stripe retries it.",
  },
  // three icons, three lines. shown in both states — before they pay it reads
  // as what they are buying, after it reads as what they now have.
  facts: [
    { icon: "seat", label: "Seat locked", note: "First group" },
    { icon: "editor", label: "Editor assigned", note: "Day one" },
    { icon: "deals", label: "Deals lined up", note: "We start now" },
  ] as const,
  // the reassurance under the buy button. three words each, because the long
  // version of these already sits on the landing page and this reader has
  // decided — they do not need selling to twice.
  secure: [
    { icon: "shield", label: "Stripe checkout" },
    { icon: "lock", label: "Seat held instantly" },
    { icon: "card", label: "Guarantee included" },
  ] as const,
  deals: {
    title: "Need help with deals?",
    paidBody: `Meanwhile, ${support.dealsName} runs brand deals. Message him any time and he will get you moving.`,
    unpaidBody: `${support.dealsName} runs brand deals and answers every question. Ask him anything before you pay.`,
    cta: `Message ${support.dealsName}`,
  },
  // shown when the (dash) gate turned them away. it is no longer staff only:
  // a paid seat or an agency's invite both open it, so say which is missing.
  denied:
    "Your account is not on a plan yet. Pay below to open the dashboard, open your agency's invite link if you were sent one, or create a workspace if you run one.",
  signOut: "Sign out",
};

// The header. Three links, flat. The dropdown that used to hold five section
// anchors went with the five sections — a menu that opens onto three items is
// a click charged for nothing.
//
// Every anchor is `/#thing`, not `#thing`. The header renders on /privacy and
// /terms too, where a bare hash scrolls to nothing.
// No links in the header, as of 2026-08-22. It held five: three anchors into
// this same page and two doors out of it. The three anchors competed with the
// scroll a landing page is built to win, and the two doors sent a creator who
// had not decided anything yet to a different product's pitch.
//
// Every one of them is still in the footer, which is where a reader who wants
// a specific page goes looking. The bar is now the wordmark, sign in and the
// one ask. `navLinks` stays exported and empty because SiteNav takes a `links`
// prop and the mentorship pages pass their own.
export const navLinks: { href: string; label: string }[] = [];

// The footer. Grouped rather than one flat row, because the flat row put "Terms
// of Service" and "Pricing" at the same weight. This is the only place legal is
// linked now that it is out of the header, so do not drop the group.
export const footerNav = [
  {
    heading: "Product",
    links: [
      { href: "/#pricing", label: "Pricing" },
      { href: "/#reviews", label: "Reviews" },
      { href: "/#faq", label: "FAQ" },
      { href: "/ugc-mentorship", label: "In a mentorship?" },
      { href: "/mentorships", label: "For mentorships" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/sign-up", label: "Get Started" },
      { href: "/login", label: "Sign In" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

// The row of marks under the wordmark in the footer.
//
// `href` is null until somebody hands over the real handle, and the footer
// skips a null rather than rendering a link to nowhere: a dead social icon in
// a footer is worse than an empty row, because the reader who clicks it learns
// the site is unmaintained. Fill one in and it appears.
export const socials: { name: string; label: string; href: string | null }[] = [
  { name: "instagram", label: "Instagram", href: null },
  { name: "tiktok", label: "TikTok", href: null },
  { name: "youtube", label: "YouTube", href: null },
  { name: "x", label: "X", href: null },
];

export const hero = {
  // No eyebrow. It carried the launch date, the date is gone, and a slot kept
  // warm with a decorative line is a slot that gets filled with one.
  // one entry per line of the h1, so the three rows break where we want them
  // instead of wherever the container happens to run out. `accent` is the
  // flame-coloured segment and renders between `pre` and `post`, which lets the
  // highlight sit anywhere in a line.
  //
  // Two lines, and the whole argument is in them: one deal, and you are up.
  // The version this replaced took three lines to say "land deals in 30 days or
  // your $500 back", which is the guarantee, and the guarantee is a band of its
  // own two screens down. The fold should sell, not hedge.
  // Three rows, one entry each. "Your money back" and "and more." used to share
  // a row, which meant the accent could only break where the container ran out
  // — at the fold's real width that landed as "Your money back and / more.",
  // orphaning one word on its own line. One row per line is the only way the
  // break is ours.
  headline: [
    { pre: "One brand deal." },
    { pre: "Your money back" },
    { accent: "and more." },
  ] as { pre?: string; accent?: string; post?: string }[],
  // Two sentences. The first says who this is for, because the offer only makes
  // sense to someone who can already film. The second says what they get.
  // The one thing the fold should get somebody to do, once it exists.
  //
  // A video at the top of a page like this outsells the copy under it, so the
  // fold is built around a slot for it: headline, video, button, one line. The
  // two line drawings that used to flank the subhead are gone for the same
  // reason. Anything decorative in the fold is competing with the ask.
  //
  // `src` is null until the vsl is recorded, and the fold falls back to the
  // headline and the button. It renders nothing player-shaped in the meantime:
  // an empty video frame on a live page is worse than no video, because it
  // reads as broken rather than as coming soon.
  //
  // Drop an mp4 in /public/ (or point src at a hosted file), add a poster, and
  // the fold rebuilds around it.
  video: {
    src: null as string | null,
    poster: null as string | null,
    caption: "3 minutes: what you get, and how the guarantee works.",
  },
  sub: `You already film. We get you deals that pay ${dealRate.min} or more. We run the system, so you get paid.`,
  note: `${pricing.price} a month. One deal pays it back.`,

  // The line above the headline. It is the promise in five words, and it earns
  // its slot because it says the thing the headline cannot: who does the work.
  // The old eyebrow carried a launch date, which is why the slot sat empty.
  eyebrow: "We run the system. You get paid.",

  // The proof under the button. `lead` is the number and renders bold; `rest`
  // is the claim. Two fields rather than one string because the number is the
  // part a scroller reads and it has to be able to carry weight on its own.
  proof: {
    lead: `${capacity.taken} creators so far`,
    // capitalised: `lead` renders as its own sentence, full stop and all.
    rest: "Everyone has made back more than they paid.",
  },

  // Faces beside the proof line. Empty on purpose: a stock avatar next to a
  // real claim is the one thing on this page that would be a lie. Drop real
  // headshots in /public/faces/ and list them here and the row appears.
  faces: [] as { src: string; alt: string }[],
  // How many blank rings to draw while `faces` is empty. They are a shape, not
  // a person: no photograph, no initial, nothing that claims to be anybody. The
  // row exists because the proof line needs a left edge to sit against, and it
  // disappears the moment real headshots land above.
  facePlaceholders: 5,

  // The bar on the floor of the fold. Three facts, no argument. This is the
  // trust row that used to live here as plain text, given a surface so it reads
  // as the base of the fold rather than a fourth line of body copy.
  stats: [
    {
      icon: "dollar" as const,
      value: `${pricing.price}${pricing.period}`,
      label: "Everything included",
    },
    {
      icon: "shield" as const,
      value: "30-day guarantee",
      label: "Get your money back",
    },
    {
      icon: "check" as const,
      value: "Keep 100%",
      label: "Of every deal you land",
    },
  ],

  // The picture beside the fold. It is the product, not decoration: the reader
  // is being asked to pay for a dashboard and a room, so the fold shows both.
  //
  // `src` is the override. Drop a real screenshot in /public/landing and set it
  // and the drawn mock below is replaced wholesale, no code change. Until then
  // components/hero-shot.tsx draws it from these numbers, which is why they are
  // here rather than hardcoded in the markup — the day one of them changes it
  // changes in one place.
  shot: {
    src: null as string | null,
    alt: "The Creator Empire dashboard: deals, earnings and what is still owed.",
    title: "Dashboard",
    tiles: [
      { label: "Deals", value: "24" },
      { label: "Earnings", value: "$18,450" },
      { label: "Pending", value: "$6,750" },
      { label: "This month", value: "$3,250" },
    ],
    dealsTitle: "Recent deals",
    deals: [
      { brand: "Skincare Brand", when: "Mar 12", amount: "$1,200", paid: true },
      { brand: "Wellness Co.", when: "Mar 09", amount: "$980", paid: true },
      { brand: "Drink Mix", when: "Mar 04", amount: "$1,450", paid: false },
      { brand: "App Promo", when: "Feb 27", amount: "$1,500", paid: true },
    ],
    moreLabel: "View all",
    paidLabel: "Paid",
    pendingLabel: "Pending",
  },

  // The card that overlaps the dashboard. The room is the half of the offer a
  // screenshot cannot show, so it gets its own object on top of one.
  //
  // `thumb` is null until there is a real still from a call. It falls back to a
  // plain tinted frame with a play mark, never a stock face: a stranger's photo
  // sitting on a claim about our own room is the one lie this page could tell.
  call: {
    thumb: null as string | null,
    title: "Weekly group call",
    lines: ["Every Thursday at 11am ET.", "Real rates. Real briefs."],
    ctaLabel: "Join room",
  },
};

export const signup = {
  title: "First, let's get you set up",
  sub: "All fields except SMS consent are required. Checkout opens on the next step and your spot is saved as soon as it clears.",
  submitLabel: "Sign Up",
  backLabel: "Back",
  smsConsent:
    "By checking this box, I consent to receive text messages from Creator Empire about my account, coaching calls and brand deal opportunities. Message frequency varies, message and data rates may apply. Reply STOP to opt out.",
  marketingConsent:
    "By checking this box, I consent to receive marketing messages from Creator Empire including offers, discounts and product updates at the number provided. Reply STOP to opt out.",
  footnote: "Your spot, your free portfolio and your guarantee are locked the second your payment clears.",
};

// Real messages from creators, screenshotted the way they arrived. The files
// live in public/testimonials, one per message, named after the person so a
// swap is obvious in a diff.
//
// `w` and `h` are the file's true pixel size. next/image needs them to hold the
// space before the png loads, so re-measure when a file is replaced.
//
// `alt` carries the message, not a description of it. The words ARE the proof
// and a screenshot hides them from anyone on a reader.
//
// `narrow` is for a portrait shot. Wide screenshots fill the column; a tall one
// left at full width dwarfs everything under it.
export type ShotTestimonial = {
  src: string;
  alt: string;
  w: number;
  h: number;
  name: string;
  source: string;
  narrow?: boolean;
};

// The second half of the same band, empty on purpose. Drop an mp4 in
// public/testimonials and add a row here and the video grid appears. No rows
// means no grid, so the page never shows an empty slot waiting to be filled.
export type VideoTestimonial = {
  src: string;
  poster?: string;
  name: string;
  source: string;
};

export const testimonials = {
  eyebrow: "Receipts",
  title: "In their own words",
  sub: "We did not write any of these.",
  videoTitle: "On Camera",
  shots: [
    {
      src: "/testimonials/amanda-discord.png",
      alt: "Amanda: I just wanted to say that I am really grateful for meeting you, for this opportunity. You have no idea how much my life perspective has changed ever since working as a UGC creator. I am already in new deals, doing everything I can to make my dreams come true.",
      w: 1748,
      h: 460,
      name: "amanda.fênix",
      source: "Discord",
    },
    {
      src: "/testimonials/gustavo-discord.png",
      alt: "Gustavo: I just wanted to thank you for everything during my time in this program. You helped me so much with scaling and growing with UGC and content in general.",
      w: 1856,
      h: 288,
      name: "Gustavo",
      source: "Discord",
    },
    {
      src: "/testimonials/sam-discord.png",
      alt: "Sam: Just wanted to thank you for everything you have done with getting me on deals and just being a great coach overall.",
      w: 1768,
      h: 416,
      name: "Sam",
      source: "Discord",
    },
    {
      src: "/testimonials/creator-text.png",
      alt: "A creator over text: Genuinely thank you. I am truly thankful for being a part of my journey, thanks for replying to my millions of questions.",
      w: 554,
      h: 516,
      name: "A creator",
      source: "Text",
      narrow: true,
    },
  ] as ShotTestimonial[],
  videos: [] as VideoTestimonial[],
};

// Seven rows. Every one of them is a doubt the page cannot answer inside a
// band without slowing the band down. A question the page already answers up
// top reads as a doubt we planted ourselves, so it does not go here.
export const faq = {
  eyebrow: "Questions",
  title: "Every question, answered",
  // Backup copy, not the only copy. Every one of these is also answered in the
  // band it belongs to, so a reader who never opens this section already knows
  // what a cut costs and how the refund works.
  //
  // Same writing rule as the rest of the file: short sentences, one idea each.
  // An faq answer that runs four clauses is a paragraph somebody wrote to feel
  // thorough, and it gets skimmed.
  closing: {
    title: "Still deciding?",
    sub: "The first group stops at 30 creators.",
    cta: "Get Creator Empire",
  },
  items: [
    {
      q: `What do I get for ${pricing.price} a month?`,
      a: "Four things. Brand deals placed for you. The app that tracks your money, plus the tools. The room and a call every week. And editors who cut your videos for $1 to $3.",
    },
    {
      q: "Do you take a cut of my deals?",
      a: `No. Never. You keep every dollar a brand pays you. The ${pricing.price} a month is all we make.`,
    },
    {
      q: `Is ${dealRate.min} a deal promised?`,
      a: `${dealRate.min} is the floor, not the ceiling. Plenty pay more. What you make depends on how much you film. The promise is the other half: land a deal and make back more than you paid in 30 days, or we refund you.`,
    },
    {
      q: `Is editing included in the ${pricing.price}?`,
      a: "$30 of it is, every month. After that you pay per video. A reaction is $1. Anything else is $2. An 18 hour turnaround is $3. You paying keeps the price at $1.",
    },
    {
      q: "How fast do edits come back?",
      a: "36 hours. That is a promise. 18 hours if you pay the $3 rate. Send a whole film day at once and the batch comes back together.",
    },
    {
      q: "What if I do not like the cut?",
      a: "Send it back. Revisions are free and there is no limit. Your brand can okay a cut on a link too, with no login.",
    },
    {
      q: "How do you get me deals?",
      a: "We run campaigns with brands who buy UGC. When one fits you, we hand you the job. The rate and the brief are already agreed.",
    },
    {
      q: "I already get deals. What changes?",
      a: "Your rate and your workload. We read your deals and tell you where you are cheap. Then the app takes the tracking, the invoices and the posting off you.",
    },
    {
      q: "Is this a course?",
      a: "No. Nothing to sit through. You already know how to film. This is the deals and the business around them.",
    },
    {
      q: "Do I need followers?",
      a: "No. Brands who buy UGC care about the video, not your follower count.",
    },
    {
      q: "Who is this not for?",
      a: "Anyone who has not been paid for a UGC video. Anyone who wants a course. Anyone who wants deals but will skip the calls. We say no to them on purpose.",
    },
    {
      q: "How does the guarantee work?",
      a: `${guarantee.promise} ${guarantee.conditions} ${guarantee.fine}`,
    },
    {
      q: "Can I cancel?",
      a: "Any time. You keep access to the end of the month you paid for. We do not refund part of a month. If the 30 day guarantee fits you, use that instead. It gives the whole payment back.",
    },
    {
      q: "When do I get in?",
      a: "The second your payment clears. Your dashboard opens and your 30 days start the same day. Stripe runs checkout, so we never see your card.",
    },
  ],
};

// ---------------------------------------------------------------------------
// LEGAL PAGES
//
// NOT LEGAL ADVICE. This text was drafted to describe how the business actually
// works, not to satisfy any court. Have a lawyer review both documents before
// launch. Nothing below may be shown to a user as legal advice.
//
// Both documents render through the same wrapper, so they share one shape:
// a title, a last-updated date, and an ordered list of sections. Keep the
// guarantee wording here word for word identical to `guarantee` above, because
// checkout, the welcome email and support all have to match it.
// ---------------------------------------------------------------------------

export type LegalDoc = {
  title: string;
  updated: string;
  sections: { heading: string; body: string[] }[];
};

export const terms: LegalDoc = {
  title: "Terms of Service",
  updated: "August 7, 2026",
  sections: [
    {
      heading: "1. About These Terms",
      body: [
        `These terms are the agreement between you and ${brand.name}. They apply when you sign up, when you pay us, and every time you use the app.`,
        "If you do not agree with them, do not sign up. If you already have an account, cancel it.",
        "You must be 18 or older to use Creator Empire. You must give us real information when you sign up.",
      ],
    },
    {
      heading: "2. What Creator Empire Is",
      body: [
        "Creator Empire is a subscription service for content creators. It is not a course and not a job.",
        "While you are subscribed we do four things. We put you in front of brands running paid campaigns. We give you an editor who cuts the videos you send in. We post finished videos on the schedule you set. We give you an app that holds your deals, your posting and your payments.",
        "We do not promise a set number of brand deals. We do not promise a set amount of income. Brands choose who they hire, and what you earn depends on the work you deliver.",
        "You are not our employee, and we are not your agent or your manager. You film your own work and you file your own taxes on what you earn.",
      ],
    },
    {
      heading: "3. Subscription and Billing",
      body: [
        `The price is ${pricing.price} per month. It is charged in advance, on the same day each month, until you cancel.`,
        "Stripe processes every payment. You give your card details to Stripe, not to us. Card numbers never touch our servers, and we never see or store them.",
        "By subscribing you allow us to charge that card each month through Stripe. Keep the card on file valid.",
        "If a payment fails, Stripe will retry it. If it keeps failing we may pause your access until the balance is paid.",
        "Prices can change. If we change yours, we will email you at least 30 days before it takes effect. You can cancel before then.",
      ],
    },
    {
      heading: "4. Cancelling",
      body: [
        `${pricing.terms}`,
        "You cancel from your dashboard. It takes one click and you do not have to email anyone or sit through a call.",
        "You keep access until the end of the month you already paid for. After that, billing stops and access ends.",
        "We do not give refunds for the part of a month you did not use. If you are cancelling because the guarantee applies to you, read section 5 first.",
      ],
    },
    {
      heading: "5. The Guarantee",
      body: [
        "You get 30 days from the day your access opens. If the brand work we placed you in has not landed you a deal and paid you back more than your first month's payment in that time, we refund that payment in full.",
        "These are the conditions, and all of them have to be true.",
        "You have to have finished your profile and your onboarding in your first week. You have to have been subscribed and in good standing for the whole 30 days. You have to have accepted the deals we placed you in. You have to have delivered the footage those deals asked for, on time and to the brief. We put you in front of the brand and hand you the job. You still have to film it.",
        "Money you earn from deals you found on your own does not count toward the total, either way. Only work we placed counts.",
        "To claim it, email us at " +
          brand.contactEmail +
          " within 7 days of your 30th day. We check your delivered work and the payments in your tracker, then refund you. We may ask you for proof of what a brand paid you.",
        "The refund is your first month's payment. It is not a payment of the difference between what you earned and what you hoped to earn.",
        "The refund closes your subscription. Your access ends when it is issued.",
      ],
    },
    {
      heading: "6. Brand Campaigns",
      body: [
        "We place creators into paid campaigns that brands run through us. When we do, you get the brief and the rate before you agree to anything.",
        "You can turn down any deal. Turning down deals means less work is placed for you, and it can affect the guarantee in section 5.",
        "The brand sets the brief, the deadline and the rate. Who pays you depends on the campaign. Some brands pay you directly. On others the money comes through us and we pass it on.",
        "If you accept a deal, you have to deliver what it asks for by the date it asks for. Missing deadlines can cost you the deal and future placements.",
      ],
    },
    {
      heading: "7. Who Owns the Content",
      body: [
        "You own your footage. Filming it makes it yours, and signing up here does not change that.",
        "When you accept a brand deal, that brand gets a license to the deliverables it paid for. The campaign brief says how wide that license is, how long it lasts, and whether the brand can run it as a paid ad. Read it before you accept.",
        "You give us a license to use your work in two ways. We show it in the portfolio we build for you, and we show it to brands we are pitching you to. That is the whole point of the portfolio.",
        "We may also show your work as an example of what creators here produce, in our own marketing. Email us at " +
          brand.contactEmail +
          " if you want that stopped, and we will stop.",
        "Your license to us ends when you ask us to remove your work, except where a brand already has rights to a deliverable it paid for.",
        "You promise the work you upload is yours to give. Do not send us footage you do not have the rights to, including music you did not license and people who did not agree to be filmed.",
      ],
    },
    {
      heading: "8. Rules for Using Creator Empire",
      body: [
        "One account per person. Do not share your login. Do not resell your access.",
        "Do not upload anything illegal, hateful, or sexual. Do not upload anything that belongs to someone else.",
        "Do not misrepresent a brand or make claims about a product that the brief did not give you.",
        "Follow the disclosure rules where you live. If a video is paid, label it as paid.",
        "Do not try to break, scrape or overload the app.",
        "Do not go around us to cut us out of a campaign we introduced you to. Deals you find on your own are yours and always were.",
        "We can suspend or close your account if you break these rules. If we do, we will tell you why and we will not bill you again.",
      ],
    },
    {
      heading: "9. Your Account",
      body: [
        "Keep your password to yourself. You are responsible for what happens under your login.",
        "Tell us at " +
          brand.contactEmail +
          " if you think someone else got into your account.",
        "You can close your account any time. Section 4 covers what happens to your billing and our privacy policy covers what happens to your data.",
      ],
    },
    {
      heading: "10. What We Are Not Responsible For",
      body: [
        "We give you the service as it is. We do not promise it will never go down, never have a bug, or never lose a file. Keep your own copy of your footage.",
        "We are not responsible for what a brand does. If a brand pays late, cancels a campaign, or uses your video outside the license it bought, that is between you and the brand. We will help you chase it, but the deal is yours.",
        "We are not responsible for money you expected to make and did not.",
        "To the extent the law allows it, we are not liable for lost profits, lost income, lost data, or any indirect loss.",
        `To the extent the law allows it, the most we can owe you for anything is the amount you paid us in the 12 months before the claim.`,
        "Some places do not allow limits like these. Where that is true, these limits apply as far as they legally can and no further.",
      ],
    },
    {
      heading: "11. Changes and Ending the Agreement",
      body: [
        "We can change these terms. If a change matters, we will email you before it takes effect. Using the service after that means you accept it.",
        "You can end this agreement any time by cancelling. We can end it if you break these terms, or if we shut the service down. If we shut it down, we will refund the unused part of your last payment.",
        "Sections 7, 10 and this one survive after the agreement ends.",
      ],
    },
    {
      heading: "12. Contact",
      body: [
        `Questions about these terms go to ${brand.contactEmail}. We answer every one.`,
      ],
    },
  ],
};

export const privacy: LegalDoc = {
  title: "Privacy Policy",
  updated: "August 7, 2026",
  sections: [
    {
      heading: "1. The Short Version",
      body: [
        `This policy explains what ${brand.name} collects, why we collect it, and who else sees it.`,
        "We collect what we need to run your account, get you brand deals and edit your videos. We do not sell your data.",
        "Card details are the one thing we never hold. Stripe takes those directly.",
      ],
    },
    {
      heading: "2. What We Collect",
      body: [
        "Your name and email. We need these to make your account and to send you your login, your deals and your invoices.",
        "Your phone number. We use it to text you about your account, your calls and your deals. It is only used for texts if you tick the consent box.",
        "The content you upload. Your raw footage, your finished videos and anything you write in the app.",
        "Your account activity. Deals you accepted, videos you sent in, payments logged in your tracker, and basic records of when you signed in.",
        "Payment records. Stripe tells us when a payment cleared, when it failed and which card brand you used. We never see the full card number.",
        "Basic technical data your browser sends, like your device type and rough location from your IP address. We use it to keep the app working and secure.",
      ],
    },
    {
      heading: "3. Why We Collect It",
      body: [
        "To run your account and let you sign in.",
        "To bill you each month and to prove what you paid.",
        "To pitch you to brands and place you in campaigns.",
        "To give your editor the footage they need to cut your videos.",
        "To post your finished videos on the schedule you set.",
        "To email or text you about your account, and to answer you when you ask us something.",
        "To keep the service safe, to stop fraud, and to meet our tax and legal duties.",
      ],
    },
    {
      heading: "4. Who We Share It With",
      body: [
        "Stripe. Stripe processes every payment. You give your card details straight to them and they never touch our servers. Stripe handles that data under its own privacy policy.",
        "Supabase. Supabase hosts our database and our logins. Your account and your records are stored there.",
        "The brands we place you in. When we pitch you, a brand sees your portfolio, your content and your first name. When you accept a deal, that brand gets what it needs to work with you and pay you, which usually means your name and your email.",
        "Your editor. The editor assigned to you sees the footage you send in and nothing else about you.",
        "The platforms you connect. If you turn on auto posting, we send your finished video to the account you connected.",
        "Anyone we are legally required to share it with, if we get a valid legal request.",
        "We do not sell your personal information. We do not share it for anyone else's advertising.",
      ],
    },
    {
      heading: "5. Texts and Marketing",
      body: [
        "We only text you if you tick the SMS consent box when you sign up. Ticking it is optional and you can use the whole service without it.",
        "There are two boxes. One is for account texts, like your coaching calls and your brand deal offers. The other is for marketing texts, like offers and product updates.",
        "Message frequency varies. Message and data rates may apply.",
        "Reply STOP to any text to stop them. Reply HELP for help. You can also change it in your dashboard, or email us.",
        "Stopping texts does not stop the emails you need to run your account, like your invoice or a password reset. Marketing emails have an unsubscribe link at the bottom of every one.",
      ],
    },
    {
      heading: "6. Cookies",
      body: [
        "We set a cookie to keep you signed in. Without it the app cannot tell who you are.",
        "We do not run advertising trackers on this site.",
      ],
    },
    {
      heading: "7. How Long We Keep It",
      body: [
        "Your account data stays while your account is open.",
        "If you close your account, we delete your account data within 90 days. Ask us sooner and we will do it sooner.",
        "We keep payment and invoice records for 7 years, because tax law requires it. Those records are the amounts and the dates, not your card number.",
        "Content a brand already licensed and paid for stays with that brand. We cannot pull it back for you, and neither can you.",
        "We may keep a limited record of anyone we removed for breaking the rules, so they cannot sign up again.",
      ],
    },
    {
      heading: "8. Your Rights",
      body: [
        "You can ask for a copy of the data we hold on you.",
        "You can ask us to correct anything wrong. Most of it you can fix yourself in your dashboard.",
        "You can ask us to delete your data. Email " +
          brand.contactEmail +
          " with the subject line DELETE and we will confirm within 30 days.",
        "You can withdraw your consent to texts or marketing at any time.",
        "Depending on where you live, you may have more rights than these. Ask us and we will honour them.",
        "We never charge you for any of this and we will not make it hard.",
      ],
    },
    {
      heading: "9. Security",
      body: [
        "Your data sits in Supabase, encrypted, behind access rules that keep one creator's records away from another.",
        "Only the people who need your data to do their job can see it.",
        "No system is perfect. If a breach ever affects your data, we will tell you and tell you what we are doing about it.",
      ],
    },
    {
      heading: "10. Age",
      body: [
        "Creator Empire is for people 18 and over. We do not knowingly collect data from anyone under 18.",
        "If you think a minor signed up, email us and we will delete the account.",
      ],
    },
    {
      heading: "11. Changes and Contact",
      body: [
        "If we change this policy, we will update the date at the top. If a change matters, we will email you.",
        `Any question about your data goes to ${brand.contactEmail}. A real person reads it.`,
      ],
    },
  ],
};
