// The words this app puts on screen outside the dashboard.
//
// It used to be the ugc flows landing page: an offer, a price, a guarantee, a
// plan table, testimonials and an faq, all of it read by a marketing site that
// does not exist on this deploy. `/` redirects to the dashboard here and a seat
// is handed out by the programme, so what is left is the brand, who to ask for
// help, and the two legal documents.
//
// Writing rule for this file: short sentences, common words, one idea per
// sentence. If a line needs a comma to hold two clauses together, it is usually
// two sentences.

export const brand = {
  name: "Creator Empire",
  wordmark: "creator empire",
  tagline: "Better paying brand deals, and the system that runs all of them.",
  // the live domain. read from here rather than typed out, so a portfolio link
  // and an email address can never disagree.
  domain: "creatorempire.app",
  // the one address on the app. support, privacy requests and legal questions
  // all land here, so it is written down once and read from everywhere.
  contactEmail: "hello@creatorempire.app",
};

export const support = {
  dealsName: "Talha",
  dealsHref: "sms:+17324704350",
  dealsHandle: "+1 (732) 470-4350",
};

// ---------------------------------------------------------------------------
// Legal. Written for how THIS deploy works: a seat on one programme's
// workspace, handed out and taken back by that programme. It is not the ugc
// flows membership, and every clause that described one is gone: there is no
// $500 a month subscription here, no card on file, no cancel button and no
// 30 day guarantee, so terms that promised all four were describing a product
// this app is not.
//
// Not legal advice, and not reviewed by a lawyer. Have one read it.
//
// Both documents render through the same wrapper, so they share one shape:
// a title, a last-updated date, and an ordered list of sections.
// ---------------------------------------------------------------------------

export type LegalDoc = {
  title: string;
  updated: string;
  sections: { heading: string; body: string[] }[];
};

export const terms: LegalDoc = {
  title: "Terms of Service",
  updated: "August 26, 2026",
  sections: [
    {
      heading: "1. About These Terms",
      body: [
        `These terms are the agreement between you and ${brand.name}. They apply every time you use the app.`,
        "If you do not agree with them, do not use it.",
        `You must be 18 or older to use ${brand.name}. You must give us real information about yourself.`,
      ],
    },
    {
      heading: "2. What Creator Empire Is",
      body: [
        `${brand.name} is a workspace for creators doing brand deals. It holds your deals, works out what each one owes you, tracks your posts and their views, schedules your posting, and hands your footage to an editor.`,
        "It is a tool. It is not a course, not a job, and not an agency. We do not find you brand deals and we do not promise you any.",
        "You are not our employee. We are not your agent and not your manager. You do your own work and you file your own taxes on what you earn.",
        "The numbers in the app are a record of what you told it and what the platforms reported. They are not an invoice and not a guarantee of payment. What a brand owes you is whatever your contract with that brand says.",
      ],
    },
    {
      heading: "3. How You Get Access",
      body: [
        "Access is a seat on a programme's workspace. The programme running that workspace decides who holds a seat.",
        "You sign in with the Google account your programme put on the roster. There is no signup form here and no way to make an account on your own.",
        "The programme can remove your seat at any time. When it does, your access ends. That is their decision and not ours.",
        "We can also suspend or close an account that breaks section 6, and we will tell you why.",
      ],
    },
    {
      heading: "4. Money",
      body: [
        "We do not charge you to use this app. There is no subscription here, no card on file and nothing to cancel.",
        "Whatever you pay your programme, and whatever it promised you, is between you and them. We are not part of that agreement and we cannot refund it.",
        "If you pay an editor through the app, that payment runs through Stripe. You give your details to Stripe and they never touch our servers.",
      ],
    },
    {
      heading: "5. Who Owns the Content",
      body: [
        "You own your footage. Filming it makes it yours, and using this app does not change that.",
        "When a brand hires you, that brand gets whatever licence your agreement with it says. Read that agreement. We are not a party to it.",
        "You give us the licence we need to run the app for you: to store your files, show them to the editor you send them to, and post them to the accounts you connect. Nothing wider than that. We do not use your work in our own marketing.",
        "That licence ends when you delete the work or close your account.",
        "You promise the work you upload is yours to give. Do not upload footage you do not have the rights to, including music you did not licence and people who did not agree to be filmed.",
      ],
    },
    {
      heading: "6. Rules for Using It",
      body: [
        "One account per person. Do not share your login and do not resell your access.",
        "Do not upload anything illegal, hateful or sexual. Do not upload anything that belongs to someone else.",
        "Follow the disclosure rules where you live. If a video is paid, label it as paid.",
        "Do not try to break, scrape or overload the app.",
        "Do not use the app to send anyone anything they did not ask for.",
      ],
    },
    {
      heading: "7. Your Account",
      body: [
        "You sign in with Google. Keep that account secure, because whoever holds it holds your workspace.",
        `Tell us at ${brand.contactEmail} if you think someone else got into your account.`,
        "Ask your programme to remove your seat if you want to leave. Our privacy policy covers what happens to your data.",
      ],
    },
    {
      heading: "8. What We Are Not Responsible For",
      body: [
        "We give you the app as it is. We do not promise it will never go down, never have a bug, or never lose a file. Keep your own copy of your footage.",
        "We are not responsible for what a brand does. If a brand pays late, cancels, or uses your video outside what it agreed, that is between you and the brand.",
        "We are not responsible for what your programme does, including removing your seat.",
        "View counts come from the platforms and from public pages. They can be wrong, late or missing. Do not treat a number in this app as proof of what you are owed.",
        "To the extent the law allows it, we are not liable for lost profits, lost income, lost data, or any indirect loss.",
        "Some places do not allow limits like these. Where that is true, these limits apply as far as they legally can and no further.",
      ],
    },
    {
      heading: "9. Changes and Ending the Agreement",
      body: [
        "We can change these terms. If a change matters, we will email you before it takes effect. Using the app after that means you accept it.",
        "This agreement ends when your access does. Sections 5, 8 and this one survive it.",
      ],
    },
    {
      heading: "10. Contact",
      body: [`Questions about these terms go to ${brand.contactEmail}. We answer every one.`],
    },
  ],
};

export const privacy: LegalDoc = {
  title: "Privacy Policy",
  updated: "August 26, 2026",
  sections: [
    {
      heading: "1. The Short Version",
      body: [
        `This policy explains what ${brand.name} collects, why we collect it, and who else sees it.`,
        "We collect what we need to run your workspace, track your deals and get your videos edited and posted. We do not sell your data.",
        "We do not take a payment from you, so we hold no card details of yours at all.",
      ],
    },
    {
      heading: "2. What We Collect",
      body: [
        "Your name and email, from the Google account you sign in with. We need these to make your account and to email you about it.",
        "Your phone number, if you give us one. It is only used for texts if you turn them on, and nothing sends today.",
        "The content you upload. Your raw footage, your finished videos and anything you write in the app.",
        "Your account activity. Deals you added, videos you tracked, payouts you logged, and basic records of when you signed in.",
        "View, like and comment counts for the accounts you ask us to track. These come from the platforms' own apis and from public pages.",
        "Basic technical data your browser sends, like your device type and rough location from your IP address. We use it to keep the app working and secure.",
      ],
    },
    {
      heading: "3. Why We Collect It",
      body: [
        "To run your workspace and let you sign in.",
        "To work out what each deal owes you and show you the numbers behind it.",
        "To give the editor you chose the footage they need.",
        "To post your finished videos to the accounts you connected, on the schedule you set.",
        "To email you about your account, and to answer you when you ask us something.",
        "To keep the service safe and to meet our legal duties.",
      ],
    },
    {
      heading: "4. Who We Share It With",
      body: [
        "Your programme. Whoever runs your workspace can see the deals and the numbers on that workspace's books. That is what a roster is. Deals on your own personal account are not part of it.",
        "Supabase. Supabase hosts our database and our logins. Your account and your records are stored there.",
        "The editor you send a job to. Anyone holding the link you send them sees the footage, the brief and the notes on that job, and nothing else about you. Anyone with that link can open it, so send it only to the person doing the work.",
        "The platforms you connect. If you turn on auto posting, we send your finished video to the account you connected.",
        "Stripe, if you pay an editor through the app.",
        "Anyone we are legally required to share it with, if we get a valid legal request.",
        "We do not sell your personal information. We do not share it for anyone else's advertising.",
      ],
    },
    {
      heading: "5. Emails and Texts",
      body: [
        "We email you about things that happen in your workspace: a cut lands, a client signs off, your numbers are refreshed. You can turn each of those off in your settings.",
        "We do not send marketing email.",
        "Texts are collected but switched off. Nothing sends to your phone today. If that changes we will ask you first.",
      ],
    },
    {
      heading: "6. Cookies",
      body: [
        "We set a cookie to keep you signed in. Without it the app cannot tell who you are.",
        "We do not run advertising trackers on this app.",
      ],
    },
    {
      heading: "7. How Long We Keep It",
      body: [
        "Your data stays while your account is open.",
        "If your seat is removed, deals on your programme's books stay with that programme, because they are its records. Your own personal deals stay yours.",
        "Ask us to delete your account and we do it within 90 days. Ask us sooner and we will do it sooner.",
        "Content a brand already licensed stays with that brand. We cannot pull it back for you, and neither can you.",
      ],
    },
    {
      heading: "8. Your Rights",
      body: [
        "You can ask for a copy of the data we hold on you.",
        "You can ask us to correct anything wrong. Most of it you can fix yourself in the app.",
        `You can ask us to delete your data. Email ${brand.contactEmail} with the subject line DELETE and we will confirm within 30 days.`,
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
        `${brand.name} is for people 18 and over. We do not knowingly collect data from anyone under 18.`,
        "If you think a minor holds a seat, email us and we will delete the account.",
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
