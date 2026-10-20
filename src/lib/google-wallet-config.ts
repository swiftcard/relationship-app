// Cheap, dependency-free check for whether Google Wallet is set up — the twin
// of lib/wallet-config.ts for Android. Server components gate the "Add to
// Google Wallet" button on it, so until the keys exist no Android phone is
// ever shown a button that cannot work.
//
// To turn Google Wallet ON, set these env vars:
//   GOOGLE_WALLET_ISSUER_ID     – the Issuer ID from the Google Pay & Wallet Console
//   GOOGLE_WALLET_CLIENT_EMAIL  – the service account's email (client_email in its JSON key)
//   GOOGLE_WALLET_PRIVATE_KEY   – its private key, PEM text (private_key in the JSON key)
// The service account must be added as a user on the issuer in the Wallet
// Console, and the issuer needs Google's publishing approval before anyone
// other than the console's test accounts can save a pass.
export function hasGoogleWalletConfig(): boolean {
  return !!(
    process.env.GOOGLE_WALLET_ISSUER_ID &&
    process.env.GOOGLE_WALLET_CLIENT_EMAIL &&
    process.env.GOOGLE_WALLET_PRIVATE_KEY
  );
}
