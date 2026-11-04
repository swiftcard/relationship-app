// The two Gmail scopes the SwiftCard mailbox connection asks for, and nothing
// else (lib/agent-connect-oauth requests them; lib/crew/email/gmail uses them).
//   gmail.send      send a message; it cannot read, list or delete anything
//   gmail.metadata  headers and labels only, never a message body
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.metadata"] as const;
