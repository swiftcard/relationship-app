// GDPR-style jurisdictions: leads from these are flagged and kept out of
// exports and the sheet by default (consent rules for cold email are stricter
// there). EU/EEA, UK, Switzerland, Canada (CASL) and Brazil (LGPD).
const RESTRICTED_TLDS = new Set(["eu", "uk", "de", "fr", "es", "it", "nl", "be", "lu", "at", "ie", "pt", "dk", "se", "fi", "no", "is", "pl", "cz", "sk", "hu", "ro", "bg", "gr", "hr", "si", "ee", "lv", "lt", "mt", "cy", "li", "ch", "ca", "br"]);
const RESTRICTED_COUNTRIES = /^(eu|uk|gb|united kingdom|germany|france|spain|italy|netherlands|belgium|luxembourg|austria|ireland|portugal|denmark|sweden|finland|norway|iceland|poland|czech|slovakia|hungary|romania|bulgaria|greece|croatia|slovenia|estonia|latvia|lithuania|malta|cyprus|liechtenstein|switzerland|canada|brazil)/i;
const RESTRICTED_ISO = new Set(["GB", "UK", "DE", "FR", "ES", "IT", "NL", "BE", "LU", "AT", "IE", "PT", "DK", "SE", "FI", "NO", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "GR", "HR", "SI", "EE", "LV", "LT", "MT", "CY", "LI", "CH", "CA", "BR"]);

export function isRestrictedRegion(o: { country?: string | null; host?: string | null; email?: string | null }): boolean {
  const c = (o.country ?? "").trim();
  if (c.length === 2 && RESTRICTED_ISO.has(c.toUpperCase())) return true;
  if (c.length > 2 && RESTRICTED_COUNTRIES.test(c)) return true;
  for (const h of [o.host, o.email?.split("@")[1]]) {
    const tld = (h ?? "").toLowerCase().split(".").pop();
    if (tld && RESTRICTED_TLDS.has(tld)) return true;
  }
  return false;
}
