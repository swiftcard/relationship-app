// The browser INSIDE a social app (someone tapped a link in an Instagram bio or
// message). Google refuses its sign-in in these embedded browsers
// ("disallowed_useragent"), so a Google button there is a dead end at the last
// step of signup — exactly where an Instagram visitor arrives. Email signup
// works, and is instant.
const IN_APP = /\bInstagram\b|\bFBAN\b|\bFBAV\b|\bFB_IAB\b|musical_ly|BytedanceWebview|\bLinkedInApp\b|\bSnapchat\b|\bPinterest\b|\bLine\//i;

export function isSocialInAppBrowser(userAgent: string | null | undefined): boolean {
  return !!userAgent && IN_APP.test(userAgent);
}
