// Every word and number on /mentorships lives here. This is the B2B page: we
// are not selling a creator a seat, we are selling a mentorship more money per
// student and better deals for those students.
//
// It is a separate file from content.ts on purpose. Two audiences, two offers,
// two price shapes, and the creator page's `pricing.price` ($500/mo to a
// creator) means something completely different to the number on this page
// ($500 once per student). One file holding both is how those two get mixed up
// in a diff.
//
// WRITING RULE, and it is stricter here than on the creator page: a picture, a
// label, and four to eight words. Nothing longer. A mentor skims this page in
// twenty seconds, on a phone, between calls. Clear beats clever every time, and
// a clause that needs a comma is two lines or it is cut.
//
// Read it out loud. If a ten year old would stop on a word, swap the word.
//
// WHAT A MENTOR ACTUALLY CARES ABOUT, in order: more money per student, better
// deals for their students, and no extra calls. Nothing else. The first draft of
// this page led with the word "ecosystem" and a paragraph about graduating into
// things, which is our language, not theirs.
//
// The 25% does not go in the h1. Not squeamishness: 25% of $500 is $125, and a
// number that small in the biggest type on the page argues against the offer. It
// shows up as $125 a month, and the maths band multiplies it into a number worth
// reading.

import { brand } from "./content";

// Where every cta on this page goes. A call, not a checkout: nobody buys a
// white-labeled platform off a payment link, and the first thing we need is
// which mentorship this is.
//
// Set NEXT_PUBLIC_MENTOR_CALL_URL in vercel to a cal.com or calendly link and
// every button on the page follows with no deploy. Until one is set it is a
// mailto, which still works on a phone and never renders a dead button.
const callUrl =
  process.env.NEXT_PUBLIC_MENTOR_CALL_URL ||
  `mailto:${brand.contactEmail}?subject=White%20label%20for%20my%20mentorship`;

export const mentorships = {
  meta: {
    // the <title> and the search snippet. keyword first ("white label ugc
    // platform" and "brand deals for your students" are what a mentor types),
    // the money second, brand suffix added by the page. under 60 characters.
    title: "White label UGC platform and brand deals for your students",
    description:
      "Put our platform under your brand. Your UGC mentorship students run their whole business in it and get real brand deals. You make $500 once per student, then $125 a month on every graduate who stays.",
  },

  // The header on this page only. The creator page's three anchors are wrong
  // here: a mentor reading this does not want "Reviews", they want the model and
  // the price. Every href is absolute so the bar still works from /terms.
  nav: [
    { href: "/mentorships#platform", label: "What they get" },
    { href: "/mentorships#model", label: "The money" },
    { href: "/mentorships#price", label: "Price" },
    { href: "/mentorships#faq", label: "FAQ" },
  ],

  cta: { label: "Book a call", url: callUrl },

  hero: {
    eyebrow: "For mentorships and coaches",
    // three claims, and they are the only three a mentor is buying: their number
    // goes up, their students do better, their calendar does not move. one entry
    // per line so the break never moves with the viewport.
    headline: [
      { pre: "More money per student." },
      { pre: "Better deals for them." },
      { accent: "No extra calls for you." },
    ] as { pre?: string; accent?: string; post?: string }[],
    // five short sentences, in the order a mentor needs them. no clause is
    // carrying two ideas.
    sub: "We put our app under your brand. Your students run their deals, money and content in it. We get them brand deals too. When your coaching ends, they keep the app for $500 a month. You get $125 of that, every month.",
    note: "$500 once per student. Then $125 a month per graduate.",
    secondary: { label: "Show me the money", href: "#math" },
  },

  // The logo shelf. EMPTY ON PURPOSE, and the band renders nothing until a row
  // is added, so the page never shows an empty shelf waiting to be filled.
  //
  // Do not put a mentorship in here that is not actually a customer. A row here
  // reads as an endorsement to everybody who sees it, and a name we borrowed is
  // the one thing on this page that could cost us a real one.
  partners: {
    label: "Programs running on it",
    names: [] as string[],
  },

  problem: {
    eyebrow: "The problem",
    title: "Good students leave",
    lede: "That is what a mentorship working looks like. It is also where your money stops.",
    rows: [
      {
        icon: "clock",
        title: "Month four, they can do it alone",
        body: "Your calls stop being worth $4,000 to them.",
      },
      {
        icon: "exit",
        title: "They go, and pay you nothing",
        body: "You found them. You trained them. Now they are $0 a month.",
      },
      {
        icon: "doc",
        title: "Nothing of yours stays",
        body: "A doc, a sheet, a discord link. That is not a system.",
      },
      {
        icon: "phone",
        title: "The only way to keep billing is more calls",
        body: "And more calls is the part you cannot grow.",
      },
    ] as const,
  },

  platform: {
    eyebrow: "What they get",
    title: "One app runs their whole business",
    lede: "What you teach turns into something they open every day.",
    tiles: [
      { icon: "deals", label: "Deals", note: "Every brand in one list" },
      { icon: "money", label: "Money", note: "What is owed, what is paid" },
      { icon: "content", label: "Content", note: "Scripts, cuts, calendar" },
      { icon: "posting", label: "Posting", note: "One cut, three platforms" },
      { icon: "editor", label: "Editors", note: "Send footage, get cuts back" },
      { icon: "clients", label: "Clients", note: "Who they work with" },
      { icon: "courses", label: "Courses", note: "Your lessons, same login" },
      { icon: "chat", label: "Community", note: "Yours, or ours" },
      {
        icon: "opportunity",
        label: "Brand deals",
        note: "We hand them real work",
      },
    ] as const,
  },

  whitelabel: {
    eyebrow: "White label",
    title: "It is your brand. We stay hidden.",
    lede: "Not a link you send your students. They never see our name.",
    rows: [
      { icon: "brand", label: "Your logo", note: "And your colours" },
      { icon: "domain", label: "Your domain", note: "app.yourbrand.com" },
      { icon: "page", label: "Your landing page", note: "We build it" },
      { icon: "courses", label: "Your courses", note: "Hosted inside" },
      { icon: "chat", label: "Your community", note: "Or use ours" },
      { icon: "deals", label: "Your deals", note: "Add yours to ours" },
    ] as const,
  },

  model: {
    eyebrow: "The money",
    title: "Two prices. The second one pays you.",
    lede: "No contract. No monthly fee for your program. You pay per student, once.",
    steps: [
      {
        tag: "While they are your student",
        price: "$500",
        period: "once",
        lines: [
          "One fee when a student joins.",
          "No monthly fee for your program.",
          "Comes free with your mentorship.",
        ],
        // written out even though it is the dull half. `as const` makes each
        // entry its own type, so a key that only one member carries does not
        // exist on the union the renderer reads.
        featured: false,
      },
      {
        tag: "After they graduate",
        price: "$500",
        period: "a month, they pay",
        lines: [
          "They keep the app their work runs on.",
          "You keep $125 of every month.",
          "No calls. No coaching. No extra work.",
          "They quit, it stops. Nothing is taken back.",
        ],
        featured: true,
      },
    ] as const,
  },

  math: {
    eyebrow: "The numbers",
    title: "What one graduate is worth",
    lede: "Same student. Same four months. The only change is what stays with them.",
    example: [
      {
        icon: "money",
        label: "Four months of coaching",
        value: "$16,000",
        note: "$4,000 a month, then they go",
        featured: false,
      },
      {
        icon: "exit",
        label: "What they pay you now",
        value: "$0",
        note: "The day your coaching ends",
        featured: false,
      },
      {
        icon: "growth",
        label: "What they pay you on your app",
        value: "$125",
        note: "Every month they keep it",
        featured: true,
      },
    ] as const,
    table: {
      head: ["Graduates who stay", "They pay", "You keep"],
      rows: [
        ["10", "$5,000 / mo", "$1,250 / mo"],
        ["25", "$12,500 / mo", "$3,125 / mo"],
        ["50", "$25,000 / mo", "$6,250 / mo"],
        ["100", "$50,000 / mo", "$12,500 / mo"],
      ],
    },
    fine: "Every month. And not one call in your calendar.",
  },

  paths: {
    eyebrow: "Later",
    title: "Where your students go next",
    lede: "UGC is the way in. The app still works when they aim higher.",
    rows: [
      { icon: "agency", label: "An agency", note: "Clients, staff, money" },
      { icon: "clients", label: "Their own program", note: "Their students" },
      { icon: "saas", label: "A software product", note: "Their own tool" },
      { icon: "creator", label: "A creator brand", note: "Deals and content" },
    ] as const,
    fine: "Your best student ends up with students of their own. That is a bigger customer, not a lost one.",
  },

  price: {
    eyebrow: "Price",
    title: "What it costs",
    lede: "One number to start. One number that comes back.",
    // Not called bonuses. This buyer already makes real money and a bundle of
    // bonuses reads as an internet marketing stack, which prices it down.
    includedLabel: "You get",
    included: [
      "Your own app, your brand",
      "Your own domain",
      "A landing page for graduates",
      "Your courses inside it",
      "A community, yours or ours",
      "Brand deals for your students",
      "One screen showing every student",
      "We set the whole thing up",
      "We build what your program needs",
      "You talk to us, not a help desk",
    ],
    activation: {
      label: "Per student",
      price: "$500",
      period: "once",
      note: "No monthly fee. No minimum. No contract.",
    },
    graduate: {
      label: "Per graduate who stays",
      price: "$500",
      period: "a month",
      share: "You keep $125 of it",
      note: "Every month they keep the app.",
    },
    cta: "Book a call",
    foot: "20 minutes. We show you your program on it.",
  },

  faq: {
    title: "Questions mentors ask",
    items: [
      {
        q: "Do my students pay you while they are with me?",
        a: "No. You pay $500 once when a student joins. They pay nothing until they leave your program.",
      },
      {
        q: "Whose brand do students see?",
        a: "Yours. Your logo, your colours, your domain. Your students never need to learn our name.",
      },
      {
        q: "I already have courses and a community.",
        a: "Keep both. Courses go inside the app. Your community stays where it is, or moves in. No community yet? Your students use ours.",
      },
      {
        q: "What if a graduate cancels?",
        a: "Your $125 stops with them. Nothing is taken back. You earn on what they actually paid.",
      },
      {
        q: "Can you build what my program needs?",
        a: "Yes. That is why you work with us and not a software company. Tell us where your students get stuck and we build it.",
      },
      {
        q: "How long is setup?",
        a: "About a week. We brand it, set it up, and hand you the landing page.",
      },
      {
        q: "Do I have to sell it?",
        a: "No. It ships with your program from day one. Staying on it is the easy choice when your coaching ends.",
      },
    ],
  },

  close: {
    // the whole offer in two lines, money second. this is the pair to steal for
    // outbound.
    title: "You already did the hard part.",
    highlight: "Get paid after they graduate.",
    sub: "Better deals for your students. More money per student for you. Nothing extra in your week.",
    note: "$500 once per student. $125 a month per graduate.",
  },
};
