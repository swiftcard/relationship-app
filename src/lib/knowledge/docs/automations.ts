import { defineDocs } from "../types";

// How automated follow-ups actually behave once they're running — the part
// support gets asked about after setup, not during it.

export const automationDocs = defineDocs([
  {
    id: "when-follow-ups-send",
    title: "When automated follow-ups actually go out",
    audience: ["user"],
    triggers: [
      "when will it send", "why hasnt it sent", "why hasn't it sent", "not sent yet",
      "sending time", "what time", "schedule", "delayed", "didnt send", "didn't send",
    ],
    answer:
      "Sends are processed once a day, so a step goes out on the day it falls due rather than at a precise clock time. The times shown next to each cadence (10:06 AM and so on) describe the shape of the schedule, not the minute the message leaves.",
    detail:
      "The daily run is in the evening UTC. Texts have an extra restriction: they only go out inside a window that is between 8am and 9pm across every US timezone, so a text due on a day the run falls outside that window waits for the next one. Email has no such restriction. If someone is waiting on a message that hasn't arrived, check first whether the step is even due yet — each step in the contact's automation panel shows \"Sends <date>\" or \"Sent <date>\".",
  },
  {
    id: "automations-by-plan",
    title: "Email follow-ups on Free, text follow-ups on Pro",
    audience: ["user"],
    triggers: [
      "automation plan", "is automation free", "text automation", "sms automation",
      "email automation", "do i need pro for follow ups", "follow up plan", "pro automation",
    ],
    answer:
      "Email follow-ups are included on every plan, Free as well. Text follow-ups are Pro — the Text automation switch on a contact carries a small PRO tag, and tapping it says so. Everything else about the two is identical: the same cadences, the same editable drafts, the same one-a-day sending.",
    detail:
      "What Pro adds to EMAIL follow-ups is the writing: your steps are composed from where you met, your notes about the contact and what you do, and you can Regenerate them. A Free email follow-up starts from built-in wording instead, which you edit before activating — the cadence, the scheduling and the sending are the same. If an account moves from Pro to Free with text steps already scheduled, those texts are HELD, not deleted: the email steps keep sending, the texts wait, a single notification says so, and everything resumes on its own if the account goes back to Pro.",
  },
  {
    id: "editing-drafts",
    title: "Editing the messages before they send",
    audience: ["user"],
    triggers: [
      "edit the message", "change the message", "draft", "drafts", "regenerate",
      "rewrite", "submit and activate", "preview the messages", "subject line",
    ],
    answer:
      "After you pick a cadence, every step appears as an editable draft — text you can rewrite, and for email a subject line too. On Pro the messages are written for you from what you noted about the contact, and \"Regenerate ↺\" asks for another version; on the Free plan an email follow-up starts from built-in wording you edit yourself, so there is no Regenerate button. Nothing is scheduled until you press \"Submit & activate\".",
    detail:
      "So a sequence sitting in draft has not started; people sometimes assume picking the cadence was enough. Re-submitting a sequence that is part-way through keeps the steps that already went out, so nothing double-sends.",
  },
  {
    id: "pausing-automations",
    title: "Pausing, resuming and resetting a sequence",
    audience: ["user"],
    triggers: [
      "pause", "stop the follow ups", "stop follow-ups", "turn off automation",
      "resume", "restart", "reset automation", "stop sending",
    ],
    answer:
      "The switch on the \"Email automation\" or \"Text automation\" row pauses just that channel — steps stop and stay unsent, and switching it back on picks up where it left off. \"Reset ↺\" (visible only when the channel is off) clears that channel's messages and closes the row; the switch stays off. To start a new one, switch it on and choose a cadence.",
    detail:
      "One thing worth knowing: the TEXT switch is where permission lives. Switching it on is you confirming that contact agreed you could text them (the screen says so), and it is the only thing that allows a text to them at all; switching it off withdraws that, which blocks manual texts to them as well until you switch it back on. Email and text are independent, so pausing one leaves the other running.",
  },
  {
    id: "what-stops-a-sequence",
    title: "Why a sequence stopped on its own",
    audience: ["user"],
    triggers: [
      "sequence stopped", "automations stopped", "follow ups stopped", "paused by itself",
      "why did it stop", "sequences paused",
    ],
    answer:
      "A sequence skips steps if the contact was marked \"Closed\" or \"Not interested\", if the card it came through was taken offline, if the recipient replied STOP or unsubscribed, or if the account dropped to Free. Nothing is deleted — the steps stay unsent and resume if the cause is reversed.",
    detail:
      "A downgrade sends one in-app notification titled \"Follow-up sequences paused\". Re-subscribing resumes everything automatically, from where it stopped.",
  },
  {
    id: "what-messages-look-like",
    title: "What the emails and texts look like to the recipient",
    audience: ["user"],
    triggers: [
      "what does it look like", "who is it from", "sender", "from address", "reply to",
      "my own number", "my phone number", "branding on emails", "via swiftcard",
    ],
    answer:
      "Emails come from your name on SwiftCard's verified address, with replies going to your own card email. Texts come from one shared SwiftCard number — never your own — signed with your name and company, with your card link.",
    detail:
      "Two things a paid plan does not change, and it's worth saying so plainly. The unsubscribe link in follow-up emails is never removed on any plan; it's a legal requirement, not branding. And texts always identify SwiftCard, because Swift Card Inc is the registered sender for the messaging campaign — a paid plan removes SwiftCard's own branding from the message body, not that identification. You cannot send from your own phone number.",
  },
  {
    id: "stop-and-unsubscribe",
    title: "STOP, unsubscribes, and opted-out recipients",
    audience: ["user"],
    triggers: [
      "stop", "they replied stop", "opted out", "opt out", "unsubscribed", "cant text them",
      "blocked", "not receiving", "they unsubscribed",
    ],
    answer:
      "If someone replies STOP to a SwiftCard text, that number stops receiving SwiftCard texts entirely — from every user, not just you — until they reply START. Clicking Unsubscribe in a follow-up email does the same for that email address across the platform. Neither one is something you can undo from your side.",
    detail:
      "STOP does not stop emails, and unsubscribing from emails does not stop texts; they're separate lists. If a contact says they aren't getting your messages, an earlier STOP or unsubscribe from a different SwiftCard user is a real possibility. They opt back in themselves — by replying START, or by ticking the consent box again next time they share their info.",
  },
  {
    id: "which-numbers-get-texts",
    title: "Which phone numbers can get automated texts",
    audience: ["user"],
    triggers: [
      "cant turn on text automation", "text automation greyed out", "text switch disabled",
      "international number", "uk number", "foreign number", "number can't get automated texts",
      "not sent number", "guam", "landline",
    ],
    answer:
      "Automated texts go to US and Canadian numbers only. If a contact's number is from another country or isn't a complete phone number, the Text automation switch stays off and reads \"This number can't get automated texts\" — fix the number with \"Edit\" next to Contact Info on that contact, and the switch works.",
    detail:
      "Guam, the Northern Mariana Islands and American Samoa are also excluded from AUTOMATED texts: the daily send lands there before 8am local time, which texting rules don't allow. A step that reaches a number which turns out not to take texts (a landline, a disconnected number) is marked \"Not sent — number can't get automated texts\" and is not retried; correct the number, then switch the text automation off, press \"Reset ↺\" and set it up again.",
  },
  {
    id: "replies-and-delivery",
    title: "Replies and delivery status",
    audience: ["user"],
    triggers: [
      "reply", "replies", "did they reply", "delivered", "delivery", "failed to send",
      "not delivered", "did it send", "can i reply",
    ],
    answer:
      "When someone texts back, their reply appears in that contact's \"Conversation\" tab. Each message you've sent shows a status underneath — Sending, Sent, Delivered, Not delivered or Failed. The conversation is read-only, so you can't reply from inside SwiftCard; use the Call button or your own phone.",
    detail:
      "\"Sent\" means the carrier accepted it, not that it landed — don't promise delivery on \"Sent\" alone; \"Delivered\" is the one that confirms it. A reply is matched to a contact by phone number, so in the rare case where two different SwiftCard users hold the same number and neither has texted them, an inbound reply can't be attributed and won't appear.",
  },
]);
