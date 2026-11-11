# Appendix to Audit 02: control inventory for card creation and editing

- **Repo:** relationship-app at HEAD `655a4480`. Every file was read with `git show HEAD:` because the worktree has uncommitted changes from another session, and all line numbers are HEAD line numbers.
- **Read-only:** nothing in the repo was changed.
- **Companion to:** `02-cards-editor-links.md`. Findings C02-001 to C02-013 are referenced by ID and not repeated. New defects are numbered **C02-A01** onward and listed at the end.

## How to read the tables

| Column | Meaning |
|---|---|
| Surface | Where the control appears |
| Control | Exact visible label or `aria-label` |
| file:line | Where the control is defined |
| Handler | The function the control calls |
| API | The route it calls (METHOD path) |
| Written | The table, storage or local state it writes |
| Gating | Which plan may use it, and how that is enforced |
| Load | Loading state shown? |
| Err | Error shown? |
| DS | Double-submit guard? |
| PreH | Works before hydration? |
| Notes | Remarks and defect IDs |

Shorthand used in the cells:

- **LS→save**: the control only changes local state, and the parent's save writes it.
  - Edit card: `PATCH /api/cards/[id]` → `cards` columns and `customization`.
  - Wizard: `POST /api/cards` → `cards` insert.
  - Office Branding: `PATCH /api/office/brand` → `offices.brand_*`, then propagated to team cards.
- **JS-only**: a React handler on a `<button>`. It does nothing before hydration.
- **CEF** = `src/app/cards/[id]/edit/CardEditForm.tsx`, **W** = `src/app/cards/new/NewCardWizard.tsx`, **P** = `src/app/cards/new/page.tsx`.
- **§n** = see section n of this appendix.
- **✔** = re-checked by hand during assembly.

### Server-side gating the "Gating" column relies on (verified)

**`POST /api/cards`**
- Free card cap: checked at :47 (402). The check and the insert (:207) are not atomic (C02-A55).
- Pro design keys: `sanitizeCustomizationForPlan` at :109; `custom` becomes `classic-pro` at :111.
- Both are skipped when the body sends `chosenPlan` "pro" or "office" (:69-70). This is deliberate: the public render re-sanitizes against the real plan.

**`PATCH /api/cards/[id]`**
- Free view-only cards are refused with 403 (:98-108); `custom` becomes `classic-pro` (:109).
- Pro customization keys and links over the Free cap are stored as sent: `sanitizeCustomizationForPlan(..., {preserveDowngraded:true})` returns its input (:169-171, plan.ts:379).
- So on write the plan is enforced in the UI only (the Pro-required dialog at Save); on display it is enforced at render. The route comment (:143-168) says this is deliberate, so it is a design note here, not a defect.

**Uploads** (`POST /api/upload`, `POST /api/upload/link-video`)
- Only `field=create` is plan-checked (:101-104).
- `logo`, `photo`, `cardbg`, `hero`, `pagebg`, `link` and link videos are accepted from any signed-in account, and from guests.

**AI routes**
- `/api/design-transfer` (:81 consent, :91 plan), `/api/scan-design` (:35, :46) and `/api/design-generate` (:68) all check AI consent (`aiConsentBlock`) and the plan on the server.
- `design-generate` also allows a Free account's first card and anonymous visitors, under rate limits.

**Office**
- `PATCH /api/office/brand`: `requireOfficeCapability("manage_branding")` plus the owner's `enterprise` plan.
- `PATCH /api/office/cards/[id]`: `manage_member_cards`, plus `officeOwnsCard`, plus only the owner may edit the owner's own card.

**Admin**
- `POST /api/admin/create-card`: `requireAdmin()` (email allow-list).

**Coverage checks**
- Every route referenced below exists at HEAD (checked with `git ls-tree`).
- No handler in scope is a pure no-op.

---

## 1. Create-card wizard (`/cards/new`)

There is no `<form>` and no password field in the wizard, so the credential-in-URL rule does not apply.

### 1a. Server entry (P)

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Entry | `?plan=pro` (signed in, has a card) | P:65-76 | server redirect | → /checkout?plan=pro… | – | server | – | – | – | server | Only Pro is fast-pathed, not Office (C02-A54) |
| Entry | `?add=1` at the Free cap | P:110-117 | redirect | → /upgrade?from=card-limit | – | Free cap (server) | – | – | – | server | `authedPlan` and `postcheckout` are exempt |
| Entry | Office member who already has a card | P:124 | redirect /dashboard | – | – | Office (server) | – | – | – | server | |
| Entry | `?claim=1` GuestDraftClaim (auto-run; "Try again" / "Back to my card") | P:216; GuestDraftClaim.tsx:57,176,184 | claim() | POST /api/drafts/claim | cards (+ storage) | server | "Saving your work…" | alertdialog | `ranRef` on auto-run only | JS-only | C02-008 |

### 1b. Resume screen and top navigation

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Resume | "Home" | W:1454 | HomeLink | GET / | – | – | – | – | – | Yes (`<a>`) | |
| Resume | "Continue your card" | W:1467 | continueDraft | – | localStorage draft | – | – | – | idempotent | JS-only | Only appears after mount |
| Resume | "Start a new card" | W:1477 | startNewCard → drafts.clear() | – | deletes localStorage draft | – | – | – | – | JS-only | Warning line shown above it |
| Steps 2–4 | "Back" | W:1514 | setStep(step-1) | – | draft | – | – | – | – | JS-only | |
| Step 1 (guest) | "Home" | W:1525 | Link + resetMarketingSketch | – | clears prefill | – | – | – | – | Yes | |
| Step 5 | "Dashboard" | W:1546 | Link + markPushAsked | /dashboard | localStorage | – | – | – | – | Yes | |
| Step 1 (signed in) | "Dashboard" | W:1553 | DashboardLink | /dashboard | – | – | – | – | – | Yes | |
| Step indicator 1–4 | Circles | W:1569-1583 | none (`div`) | – | – | – | – | – | – | – | Not clickable |

### 1c. Step 1: card information

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Prefill banner | "Autofill my details" / "Start blank" | W:1611 / W:1614 | applyPrefillData / setPendingPrefill(null) | – | state + draft | Custom template refused unless `customDesignAvailable` (W:460) | – | – | – | JS-only | |
| About | "Full name *" | W:1684 | setName | – | draft | – | – | inline role=alert (W:1704) | – | controlled | maxLength 80. Server requires a name (route:76-81). Non-Latin names are blocked (C02-A52) |
| About | "Job title" | W:1712 | setTitle | – | draft | – | – | – | – | controlled | |
| About | "Company name" | W:1717 | setCompany | – | draft | Office member: hidden, and blanked by the server (route:137-145) | – | – | – | controlled | |
| Reach | "+ Add number" | W:1727 | addPhone | – | draft | – | – | – | – | JS-only | No count cap. Amber note when more than 4 numbers (W:1802) |
| Reach (per row) | Label select "Label for phone number N" (Office members see static "Mobile") | W:1751 / W:1744 | updatePhone | – | draft | Office mobile-only label is forced in the client only (C02-A59) | – | – | – | controlled | |
| Reach (per row) | Number input (tel) | W:1763 | updatePhone | – | draft | – | – | – | – | controlled | Clamped by the server |
| Reach (per row) | "On card ✓" / "Off card" | W:1778 | updatePhone(showOnCard) | – | draft | – | – | – | – | JS-only | |
| Reach (per row) | × "Remove number" | W:1794 | removePhone | – | draft | – | – | – | – | JS-only | Only shown when there is more than one row |
| Reach | "Email" | W:1815 | setEmail | – | draft | – | – | – | – | controlled | `type=email`, but with no `<form>` the browser never validates it |
| Reach | "Website" | W:1826 | setWebsite | – | draft | Office: UI and server | – | – | – | controlled | |
| Location | "Address & fax" fold | W:1846 | `<details>` | – | – | Hidden for Office | – | – | – | Yes (native) | |
| Location | AddressInput: "Add address (optional)", Street, Unit, City, State, Zip, "Done" | AddressInput.tsx:35,44,53,61,70,78,87 | setOpen / onChange | – | draft (customization.address) | Office: server overlays | – | – | – | button JS-only | State maxLength=2; placeholders only, no labels (C02-A61) |
| Location | "Fax number" | W:1856 | setFax | – | draft | Office: server | – | – | – | controlled | |
| Nickname | "Card nickname *" | W:1866 | setNickname | – | draft (label) | Hidden for Office | – | outline + W:1889 | – | controlled | No maxLength and no server clamp (C02-A49). Required in the UI only (C02-A60) |
| Step 1 | "Next: Card design →" | W:1891 | goNextFrom1 | – | – | – | – | yes | – | JS-only | C02-A52 |

### 1d. Step 2: card design (mount points; component internals are in §3 and §4)

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Step 2 | PinnedCardPreview "See your card full size" + overlay "Close" | W:2126; PinnedCardPreview.tsx:120,371 | expand / close | – | – | – | – | – | – | JS-only | |
| Step 2 | UndoDesignButton (desktop pill) | W:1365 | cardHistory.undo | – | state | – | – | – | – | JS-only | |
| Step 2 | "Logo & headshot" fold | W:2136 | `<details>` | – | – | – | – | – | – | Yes | |
| Step 2 | Company logo ImageUpload (field=logo, defer, guest) | W:2177 | setLogoUrl | POST /api/upload when signed in; data URL for guests | storage card-uploads; `cards.logo_url` on create | Office: server forces the brand logo | §4 | §4 | §4 | JS-only | |
| Step 2 | LogoSuggest | W:2180 | setLogoUrl | POST /api/logo-suggest | – | – | §4 | §4 | §4 | JS-only | C02-A18 |
| Step 2 | Segmented "Logo shape on the card" | W:2187 | setLogoShape | – | draft | all | – | – | – | JS-only | |
| Step 2 | Headshot ImageUpload (field=photo) | W:2203 | setHeadshotUrl | POST /api/upload | card-uploads; customization.photoUrl | – | §4 | §4 | §4 | JS-only | C02-013 |
| Step 2 | ProfilePhotoSuggest | W:2221 | setHeadshotUrl | /api/photo-suggest, /api/integrations/linkedin/connect | – | – | §4 | §4 | §4 | JS-only | Return path accepts only our own storage host (W:1106-1119) |
| Step 2 | TemplatePicker (`customUnlocked={customDesignAvailable}`) | W:2248 | setTemplate | – | draft | Custom: paid or first card. Server rewrites it unless `chosenPlan` is set | – | – | – | JS-only | Replaced by a notice when the Office look is locked (W:2235) |
| Step 2 | CustomCardDesigner (`canScan={isPro}`) | W:2265 | setCustomLayout | /api/design-generate; /api/design-transfer and /api/scan-design (Pro) | – | server | §3 | §3 | §3 | JS-only | |
| Step 2 | TemplateStyleControls (`locked={!designUnlocked}`, canUpload) | W:2275 | patchTemplateStyle | POST /api/upload field=cardbg | card-uploads | Pro keys: UI lock + server sanitize on POST | §3 | §3 | §3 | JS-only | |
| Step 2 | PlanGate "Any color, every finish and photo backgrounds come with Pro →" | W:2281 | Link /upgrade | – | – | Not Pro and not unlocked | – | – | – | Yes | Effectively unreachable (C02-A62) |
| Step 2 | "← Back" / "Next: Socials →" | W:2292 / W:2295 | setStep | – | – | – | – | – | – | JS-only | |

### 1e. Step 3: socials

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Step 3 | "Bio *" textarea | W:1925 | setBio | – | draft (customization.bio) | Office bio is read-only; server overlays it | – | "Add a bio to continue." (W:1940) | – | controlled | No maxLength (C02-A49). Required in the UI only (C02-A60) |
| Step 3 (×7) | SocialHandleField "<Network> username or profile link" | W:1954; SocialHandleField.tsx:363 | setSocial / normalizeOnBlur / LinkedIn paste extraction (:387) | – | draft (linkedin, instagram, tiktok, twitter columns; facebook, snapchat, youtube in customization) | Office Instagram is read-only and forced by the server | – | amber/red hint (:404-414) | – | controlled | No length cap (C02-A49) |
| Step 3 (per social) | "Open" | SocialHandleField.tsx:334 | `<a target=_blank>` | external | – | – | – | – | – | Yes | |
| Step 3 (LinkedIn) | "Find my exact link" | SocialHandleField.tsx:211 | `<a href=linkedin.com/in/me>` | external | – | – | – | – | – | Yes | |
| Step 3 (LinkedIn, phone) | "Paste my link" | SocialHandleField.tsx:236 | paste() via clipboard | – | draft | – | – | amber note | – | JS-only | |
| Step 3 (per row) | Section header title input | W:1990 | setLinks | – | draft | Read-only on office rows | – | – | – | controlled | |
| Step 3 (per row) | × "Remove section" / × "Remove <label>" | W:2001 / W:2011 | removeLink | – | draft | Office rows show "Company" instead | – | – | – | JS-only | |
| Step 3 | AddLinkForm (`idPrefix=wizard-link`) | W:2031 | addLink (adds https://) | – | draft | Free cap of 2: UI (W:839) + server slice on POST | – | Empty input returns silently (W:844) | – | JS-only | C02-A23, A24, A25, A53 |
| Step 3 | At cap: PlanGate "Upgrade to Pro" | W:2027 | Link /upgrade | – | – | `!isPro` | – | – | – | Yes | A guest is bounced to /login?next=/upgrade and the draft is not claimed (C02-A53) |
| Step 3 | "+ Add a section header" | W:2039 | append header | – | draft | Shown when designUnlocked | – | – | – | JS-only | C02-A25 |
| Step 3 | "← Back" / "Next: Social design →" | W:2057 / W:2060 | setStep / requireBio | – | – | – | – | bio error | – | JS-only | |

### 1f. Step 4: social design and create

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Step 4 | PinnedLinkPreview (tap to expand, section chips) + desktop Undo pill | W:2310, W:1419; PinnedCardPreview.tsx:289-315 | expand / scroll / undo | – | – | – | – | – | – | JS-only | Clickable `div` with no role or keyboard handler |
| Step 4 (Office look locked) | LinkButtonsControls | W:2332 | setLinks | /api/upload field=link; /api/upload/link-video | card-uploads | Office rows locked | §5 | §5 | §5 | JS-only | |
| Step 4 | SwiftLinkStyleControls (`locked={!designUnlocked}`, canUpload) | W:2337 | patchLinkStyle / setLinks | /api/upload (hero, pagebg); link-video | card-uploads | LINK_STYLE_KEYS stripped on POST unless `chosenPlan` is set | §5 | §5 | §5 | JS-only | Comment at W:2344 is stale (C02-A63) |
| Step 4 | Switch "Link to your business card" | W:2355 | setShowCardLinkBtn | – | draft (hideCardLink) | all | – | – | – | JS-only | |
| Step 4 | PlanGate "Unlock custom colors & fonts with Pro →" | W:2366 | Link /upgrade | – | – | – | – | – | – | Yes | Unreachable (C02-A62) |
| Step 4 | Native PlanNotice "Multiple cards…" | W:2378 | display only | – | – | Native app, Free at cap | – | – | – | – | |
| Step 4 | "← Back" | W:2396 | setStep(3) | – | – | – | – | – | – | JS-only | |
| Step 4 | **"Save & create account →" (guest) / "Create card →" / "Continue to plans →"** | W:2408-2434 | requireBio, then by case (see note) | **POST /api/cards** | **`cards` insert**; `leads` (demo contact on first card); `profiles.customization._planChosen`; `offices` brand seed; welcome email in `after()` | Free cap: UI + server 402, not atomic (C02-A55). Pro design: UI + server sanitize (bypassed by `chosenPlan`). Office overlays forced by the server (route:129-172) | "Creating…" + disabled | W:2372 shows `data.message\|\|data.error`; no role=alert (C02-A57); raw DB text (C02-A56) | **creatingRef (W:1197)** + disabled | JS-only | Guest: `requireAuth(forceGate)` opens GuestGateModal and never POSTs. Signed-in first card: `setShowPlan`. Otherwise: `handleCreate`. A 402 goes to /upgrade?from=card-limit (C02-A54) |

### 1g. Plan-gate overlay (signed-in first card on Free, W:2471-2541) and FreeDesignChoice

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Plan gate | "Back to your card" | W:2489 | setShowPlan(false) | – | – | Free first card | – | – | – | JS-only | No role=dialog, Escape or focus trap (C02-A34) |
| Plan gate | ReferralGiftPanel "Start my free month…" | W:2505; ReferralGiftPanel.tsx:19 | handleAuthedFirstCardGift | POST /api/cards (chosenPlan pro) → POST /api/account/choose-plan {referralMonth} | cards; profiles (atomic gift claim, choose-plan:60-71) | Server checks the gift is still pending | busy | A choose-plan failure goes silently to /welcome (W:1343) | creatingRef + atomic claim | JS-only | |
| Plan gate | PlanCards "Continue with Free →" | W:2517; PlanCards.tsx:118 | handleAuthedFirstCardFree → FreeDesignChoice or handleCreate(free) | POST /api/cards | cards, profiles | Server sanitize | step 4 "Creating…" | step 4 error | creatingRef (PlanCards `busy={null}`, so it is never disabled) | JS-only | |
| Plan gate | PlanCards Pro "Try Pro free for N days →" / Office "Get Office · … →" (+ seat picker) | PlanCards.tsx:134,151; W:2519 | handleAuthedFirstCardPaid → create, then /checkout | POST /api/cards → /checkout | cards (Pro design kept) | `chosenPlan` bypass; render re-sanitizes ([username]/page.tsx:238) | same | same | creatingRef | JS-only | |
| Plan gate (native) | IAP subscribe / Office "open on website" / promo "Use CODE on swiftcard.me" | W:2531-2532; PlanCards.tsx:225,229,350 | onIapPurchased → handleCreate(iap); on return (visibilitychange W:768-780): trial-eligible check, then create | GET /api/iap/trial-eligible; POST /api/cards | cards | Apple / server | – | none on the return path | creatingRef | JS-only | |
| FreeDesignChoice (web) | "Keep my card exactly like this — N days free →" / "— get Pro →" | FreeDesignChoice.tsx:86 | onKeepWithTrial → handleAuthedFirstCardPaid("pro") | POST /api/cards → /checkout | cards | Web only | "Saving…" | step 4 | disabled={busy} + creatingRef | JS-only | No `type="button"` (latent, C02-A64) |
| FreeDesignChoice (native) | IapSubscribeButton "Keep my card exactly like this…" | FreeDesignChoice.tsx:107-119 | onIapPurchased → handleCreate(iap) | StoreKit; POST /api/cards | cards | Native only | NativePaywall | NativePaywall | NativePaywall | JS-only | |
| FreeDesignChoice | "Continue with Free and redesign using free features only" | FreeDesignChoice.tsx:127 | confirmFreeDesignAndCreate | POST /api/cards (free) | cards, profiles | Client conversion + server sanitize | "Saving…" | step 4 | creatingRef | JS-only | Design stays converted if the POST fails (C02-A58) |

### 1h. Guest gate, step 5 and background

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GuestGateModal | Backdrop "Close" / Escape / "Keep editing" | GuestGateModal.tsx:58,39,113 | setOpen(false) | – | – | – | – | – | – | JS-only | role=dialog + useDialogA11y (good) |
| GuestGateModal | "Create account" | GuestGateModal.tsx:91 | `<a href=/login?mode=signup&next=…claim=1>` + markClaimConsent | /login | localStorage claimRequestedAt | – | – | – | – | Yes | |
| GuestGateModal | "Log in" | GuestGateModal.tsx:98 | `<a href=/login?next=…>` + markClaimConsent | /login | same | – | – | – | – | Yes | |
| GuestGateModal | "Terms" / "Privacy Policy" | GuestGateModal.tsx:109-110 | Link | – | – | – | – | – | – | Yes | |
| Step 5 | CopyButton (live URL) | W:2082; CopyButton.tsx:21 | clipboard.writeText | – | – | – | – | window.prompt fallback | – | JS-only | |
| Step 5 | QRCodeModal "Show QR" | W:2100 | §6d | – | – | – | – | – | – | JS-only | |
| Step 5 | ShareButton "Share link" (ownCard) | W:2101 | §6d | – | – | – | – | – | – | JS-only | |
| Step 5 | EnablePushButton switch "Push notifications" / "Open iPhone Settings" / "Open Settings" | W:2104; EnablePushButton.tsx:405,588 | enable / disable | POST / DELETE /api/push/subscribe | push_subscriptions | – | disabled={busy} | varies | busy | JS-only | |
| Step 5 | GetTheAppCard | W:2106; AppStoreBadge.tsx:231 | `<a>` | App Store or /download | – | – | – | – | – | Yes | |
| Step 5 | "Go to my dashboard →" | W:2108 | markPushAsked + router.push | /dashboard[?tour=1] | localStorage | – | – | – | – | JS-only | |
| Background | Draft autosave / restore | W:959-992, 1121-1164 | drafts.save (400 ms debounce) | – | localStorage swiftcard_guest_draft / swiftcard_card_draft:<uid> | – | – | – | – | After hydration | Silent restore can overwrite text typed before hydration (see C02-A40) |

---

## 2. Edit card page (`/cards/[id]/edit`)

How the page is wired:

- **Save route:** `page.tsx` never passes `isPrimary`, so Save always goes to `PATCH /api/cards/[id]`. The `/api/profile` branch is dead code.
- **Dirty flag:** `dirty = typed || cardHistory.canUndo || linkHistory.canUndo` (CEF:407). `typed` is set by the root `onInput` handler (CEF:856).
- **Unsaved-changes guard:** `beforeunload` only (CEF:409-414).
- **Hydration catch-up:** CEF:261-269 recovers text typed before hydration in six fields only (C02-A40). "adopted" in the PreH column means the field is one of those six.

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Header | "Dashboard" (joined) | page.tsx:142 | Link | /dashboard?card=…&tour=1 | – | – | – | – | – | Yes | Skips the unsaved guard (C02-A39) |
| Header | "Dashboard" | page.tsx:149 | DashboardLink | /dashboard?card=… | – | – | – | – | – | Yes | C02-A39 |
| Joined banner | "Go to my dashboard →" | page.tsx:172 | Link | /dashboard | – | – | – | – | – | Yes | C02-A39 |
| Page (auto) | GuestDraftClaim (`?claim=1`) | page.tsx:137 | mount effect | POST /api/drafts/claim | cards | – | – | – | – | JS-only | C02-008 |
| Page (auto) | ShareCardCapture (invisible) | page.tsx:193 | effect | POST /api/card-share-image | storage card-shares | – | – | – | – | JS-only | Not a control; C02-001 |
| Tabs | "Card info" / "Card design" / "Socials" / "Social design" | CEF:864-873 | setTab | – | – | – | – | – | – | JS-only | Server picks the initial tab |
| Card info | "Full name *" | CEF:947 | setName | LS→save | cards.name | – | – | "Full name is required." (CEF:579) | – | adopted | maxLength 60 |
| Card info | "Job title" | CEF:956 | setTitle | LS→save | cards.title | – | – | – | – | adopted | |
| Card info | "Company name" (non-Office) | CEF:961 | setCompany | LS→save | cards.company | Office: server overlay | – | – | – | adopted | Changing it can auto-rename the slug (C02-004) |
| Card info | CardUrlEditor (Office :952, non-Office :962) | CEF:952/962 | see the CardUrlEditor rows below | POST /api/cards/[id]/rename | – | – | – | – | – | – | |
| Card info | "+ Add number" | CEF:971 | addPhone | LS→save | – | – | – | – | – | JS-only | Not dirty-tracked (C02-A41) |
| Card info | Phone label select "Label for phone number N" | CEF:991 | updatePhone | LS→save | customization.phones | Office: server forces mobile (route:250-255) | – | – | – | not adopted (C02-A40) | |
| Card info | Phone number input | CEF:1001 | updatePhone | LS→save | customization.phones, cards.phone | – | – | – | – | not adopted | maxLength 30 |
| Card info | "On card ✓" / "Off card" | CEF:1009 | updatePhone | LS→save | – | – | – | – | – | JS-only | Not dirty-tracked (C02-A41) |
| Card info | × "Remove number" | CEF:1021 | removePhone | LS→save | – | – | – | – | – | JS-only | Not dirty-tracked; no confirm |
| Card info | "Email" | CEF:1042 | setEmail | LS→save | cards.email | – | – | – | – | adopted | |
| Card info | "Website" (non-Office) | CEF:1052 | setWebsite | LS→save | cards.website | Office: server | – | – | – | adopted | |
| Card info | AddressInput (button, 5 inputs, "Done") | CEF:1066; AddressInput.tsx:35-87 | setAddress | LS→save | customization.address | Office: server drops it | – | – | – | not adopted | C02-A61 |
| Card info | "Fax number" | CEF:1071 | setFax | LS→save | customization.fax | Office: server | – | – | – | not adopted | |
| Card info | "Card nickname *" | CEF:1081 | setLabel | LS→save | cards.label | Office: server override | – | CEF:585 + red ring | – | not adopted | No length cap (C02-A49) |
| Card design (phone) | PinnedCardPreview "See your card full size"; overlay "Close" / backdrop / Esc | PinnedCardPreview.tsx:120,371,365,345 (CEF:1114) | expand / onClose | – | – | – | – | – | – | JS-only | |
| Card design (phone) | UndoDesignButton "Undo last design change" | UndoDesignButton.tsx:32 | history.undo | – | – | – | – | – | – | JS-only | Only shown when canUndo |
| Card design | "Logo & headshot" `<details>` | CEF:1122 | native | – | – | – | – | – | – | Yes | |
| Card design | Company logo ImageUpload (field=logo, defer, card_id) | CEF:1152 | setCardLogoUrl | POST /api/upload | card-uploads; cards.logo_url on save | none (Free feature) | §4 | §4 | §4 | JS-only | Orphaned if never saved (C02-A27) |
| Card design | LogoSuggest | CEF:1153 | setCardLogoUrl | POST /api/logo-suggest | – | – | §4 | §4 | §4 | JS-only | C02-A18 |
| Card design | Segmented "Logo shape on the card" (Original / Circle) | CEF:1163 | setLogoShape | LS→save | customization.logoShape | all | – | – | – | JS-only | Recorded in cardHistory |
| Card design | Headshot ImageUpload (field=photo) | CEF:1189 | setPhotoState | POST /api/upload | card-uploads; customization.photoUrl | none | §4 | §4 | §4 | JS-only | |
| Card design | ProfilePhotoSuggest | CEF:1198 | setPhotoState | §4 | – | – | §4 | §4 | §4 | – | C02-A47, A48 |
| Card design | TemplatePicker | CEF:1223 | setTemplate | LS→save | cards.template | `customUnlocked={isPro}`; server rewrites custom on Free | – | – | – | JS-only | Hidden when designLocked (Office) |
| Card design | CustomCardDesigner | CEF:1235 | setCustomLayout | §3 | customization.customLayout | Mounted only when `customSelected && isPro`; `canScan={isPro}` | §3 | §3 | §3 | JS-only | |
| Card design | TemplateStyleControls | CEF:1245 | patchTemplateStyle | LS→save; panel media via /api/upload or link-video | customization colours / finish / panel* | `locked={!isPro}` (ignored by the component); proTags; Save wall; server enforces only at render | §3 | §3 | §3 | JS-only | |
| Socials | "Bio *" textarea | CEF:1279 | setBio | LS→save | customization.bio | Office linkBio is read-only + server overlay | – | CEF:601,1294 | – | adopted | No cap (C02-A49) |
| Socials | 7× SocialHandleField | CEF:1312; SocialHandleField.tsx:363 | setSocial / normalizeOnBlur | LS→save | linkedin, instagram, twitter, tiktok columns + customization facebook, snapchat, youtube | Office Instagram is managed | – | hint | – | not adopted | |
| Socials (LinkedIn) | "Find my exact link" / "Paste my link" | SocialHandleField.tsx:212-216,236 | `<a>` / paste | – | – | – | – | note | – | link: Yes | Paste is not dirty-tracked (C02-A41) |
| Socials | Section title input "Section title (e.g. Watch)" | CEF:1352 | setLinks | LS→save | customization.links | Pro (UI) | – | – | – | not adopted | |
| Socials | × "Remove section" / × "Remove {label}" | CEF:1366,1384 | removeLink | LS→save | links | Company rows locked | – | – | – | JS-only | Not dirty-tracked; no confirm |
| Socials | Link-cap PlanGate "Upgrade to Pro" | CEF:1401 | Link /upgrade | – | – | Free | – | – | – | Yes | Drops unsaved edits (C02-A39) |
| Socials | AddLinkForm | CEF:1405 | addLink | LS→save | links | `atLinkCap` (UI); not enforced on PATCH | – | – | – | JS-only | C02-A23, A24, A25 |
| Socials | "+ Add a section header" | CEF:1413 | append header | LS→save | links | isPro (UI only) | – | – | – | JS-only | |
| Social design (phone) | Link-page viewport tap (div, aria-label), section chips, "Full size", Undo pill | PinnedCardPreview.tsx:287,300,313,324 (CEF:1440) | onExpand / scrollTo / undo | – | – | – | – | – | – | JS-only | Clickable `div` with no role or keyboard handler |
| Social design | LinkButtonsControls (Office-locked branch) | CEF:1470 | setLinks | §5 | links[i].* | Company rows locked | §5 | §5 | §5 | JS-only | |
| Social design | SwiftLinkStyleControls | CEF:1475 | patchLinkStyle / setLinks | §5 | customization.link* | `locked={!isPro}` | §5 | §5 | §5 | JS-only | |
| Social design | Switch "Link to your business card" | CEF:1489 | setShowCardLinkBtn | LS→save | customization.hideCardLink | all | – | – | – | JS-only | |
| Desktop preview | "Undo" pills (card / social) + Ctrl/Cmd+Z | CEF:1598,1582; UndoDesignButton.tsx:44 | history.undo | – | – | – | – | – | – | JS-only | |
| Error area | "Upgrade to Pro" (view-only card) | CEF:1511 | Link /upgrade | – | – | Server 403 CARD_VIEW_ONLY | – | yes | – | Yes | Only appears after a failed save (C02-A43) |
| Actions | "Keep editing" (discard confirm) | CEF:1524 | setConfirmDiscard(false) | – | – | – | – | – | – | JS-only | |
| Actions | "Discard" | CEF:1527 | DashboardLink | /dashboard?card= | – | – | – | – | – | Yes | Uses the slug from page load |
| Actions | "Cancel" | CEF:1535/1539 | asks to confirm when dirty, else Link | – | – | – | – | – | – | Yes when not dirty | Misses changes that aren't typed (C02-A41) |
| Actions | **"Save changes" / "Saving…" / "Saved!" / "Error — try again"** | CEF:1543 | handleSave | **PATCH /api/cards/[id]** | cards (columns + customization merge); card-shares / card-signatures removed; notifications; wallet touch; auto-rename of slug | Free: Pro dialog (UI). Server: 403 for view-only, custom→classic-pro; Pro keys and link cap **stored as sent** | yes | server `message` or fallback | disabled only while saving (C02-A42) | JS-only. Text typed before hydration outside the six fields is saved stale (C02-A40) | C02-004/005/006; malformed JSON → 500 (C02-A51) |
| Pro dialog | Backdrop "Close" / Esc / "Keep editing" | ProRequiredDialog.tsx:84,66,168 (CEF:1612) | setProBlock(null) | – | – | Free | – | – | disabled while busy | JS-only | |
| Pro dialog | "Start my N-day free trial" / "Upgrade to Pro" | ProOffer.tsx:156 (web: Link /checkout); IapSubscribeButton (native) | Link / StoreKit | /checkout | – | – | – | – | – | Yes | **Drops the whole unsaved Pro design (C02-A39)** |
| Pro dialog | "Save without them" | ProRequiredDialog.tsx:159 | handleSave({allowFreeConversion}) | PATCH /api/cards/[id] | cards | Client converts to Free | "Saving…" | editor error | disabled while busy | JS-only | Conversion stays if the save fails |
| CardUrlEditor | "Change" | CardUrlEditor.tsx:59 | setOpen | – | – | – | – | – | – | JS-only | |
| CardUrlEditor | URL input "your-name" | CardUrlEditor.tsx:103 | setValue | – | – | – | – | normalized preview | – | JS-only | The input event bubbles and marks the main form dirty |
| CardUrlEditor | "Change URL" / "Changing…" | CardUrlEditor.tsx:122 | save() | **POST /api/cards/[id]/rename** | rpc rename_card_slug (cards.username + slug-keyed tables); releaseSlugArtifacts (card-shares, card-signatures, wallet registrations) | **None: no plan or view-only check (C02-A43)** | yes | server error / network | status guard + disabled | JS-only | C02-003, C02-012 |
| CardUrlEditor | "Cancel" | CardUrlEditor.tsx:130 | reset | – | – | – | – | – | disabled while saving | JS-only | |
| CardUrlEditor | "Got it" | CardUrlEditor.tsx:87 | location.reload() | – | – | – | – | – | – | JS-only | If the form is dirty, beforeunload prompts; accepting drops the edits |
| (n/a) | CardScopePicker | – | – | – | – | – | – | – | – | – | Not mounted here (only IntegrationsSettings and ZapierSettings) |

---

## 3. Card designer

Covers CustomCardDesigner, FreeCardEditor, the AI sheet, the camera, TemplatePicker, TemplateStyleControls and DesignControls.

Where each is mounted:

- **CustomCardDesigner (CCD):** CEF:1235 (Pro), W:2265 (Pro, or first-card AI), OfficeBranding:370 (teamBrand), and the homepage CardMiniBuilder:184 and SignatureMiniBuilder:165 (`canScan={false}`).
- **FreeCardEditor (FCE):** only inside CCD (:652).
- **TemplatePicker:** CEF:1223, W:2248, OfficeBranding:365, the mini builders, and the TeamsDashboard:850 demo.
- **TemplateStyleControls (TSC):** CEF:1245, W:2275, OfficeBranding:374, the mini builders, and TeamsDashboard:852.

### 3a. CustomCardDesigner (`src/components/CustomCardDesigner.tsx`)

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CCD | "Copy a card or template you like" (✨ MAGIC / PRO tag) | 392-433 | toggles copyChoice | – | – | canScan (UI); disabled when false | spinner "Rebuilding it with your details…" / "Copying the layout…" | – | disabled when scanning or !canScan | JS-only | |
| CCD | "Take a photo of your card" | 445-455 | opens CardScanCamera | – | – | canScan | – | – | hidden while scanning | JS-only | |
| CCD | "Upload an image" | 456-467 | fileRef.click() | – | – | canScan | – | – | hidden while scanning | JS-only | |
| CCD | Hidden file input (image/*) | 548-554 | scanPrintedCard → toJpeg → transferDesign (or scanLayoutOnly when teamBrand) | POST /api/design-transfer, or POST /api/scan-design (Office) | storage card-uploads/{uid}/art-*.png (transfer) | UI canScan + server consent + isPaidPlan | spinner; 150 s / 45 s abort | amber `<p>` (555), no role=alert | scanning flag (state only) | JS-only | C02-A35, A38; C02-007 |
| CCD → camera | CardScanCamera: "Close camera" / Esc / "Close"; "Choose photo" / "Choose a photo instead"; "Take photo" shutter + auto-capture | CardScanCamera.tsx:370,76,361,387,353,402,238 (CCD:702-709) | onClose / onPickPhoto / capture | as above | as above | Pro | "Opening camera…" / "Hold still…" | failureText | capturingRef | JS-only | |
| CCD | "AI design" (✨ NEW) | 483-516 | setAiOpen(true) | – | – | Open wherever mounted; server decides | spinner "Designing your card…" | aiError role=alert (541) | disabled when aiBusy or scanning | JS-only | |
| AI sheet | "✕" Close / backdrop / Esc / "Cancel" | AiDesignSheet.tsx:75,61,41,189 | onClose (blocked while busy) | – | – | – | – | – | – | JS-only | |
| AI sheet | 16 colour swatches (aria = hex), "Pick any colour", "Use it" / "Remove it", "Clear" | AiDesignSheet.tsx:86-117 | toggleColor / setCustom / setColors([]) | – | sheet state | – | – | – | – | JS-only | Max 2 colours; swatches named by hex (C02-A31) |
| AI sheet | Theme tiles; "Headshot on the card" / "Logo on the card" switches | AiDesignSheet.tsx:124-168 | setTheme / set(!on) | – | – | Disabled when the photo or logo is missing | – | – | – | JS-only | role=switch |
| AI sheet | "Generate my design" / "Pick a theme to continue" | AiDesignSheet.tsx:176-188 → CCD generate() 300-352 | onGenerate | POST /api/design-generate | none (layout → commit → LS→save) | Server: paid, first card or anonymous, plus consent | busy; 45 s abort | role=alert (172) | disabled={busy}, state only (C02-A38) | JS-only | |
| CCD | "↻ Try another" | 523-530 | generate(variant+1) | POST /api/design-generate | LS→save | server | aiBusy | aiError | disabled | JS-only | |
| CCD | "Change choices" | 531-538 | reopens sheet | – | – | – | – | – | disabled while busy | JS-only | |
| CCD | "Remove" (exact design is on) | 566-572 | commit({faceImage:undefined}) | – | LS→save | – | – | – | – | JS-only | |
| Transfer approval dialog | "Use this design" | 617-628 | commit(transfer.layout) | – | LS→save (bgImage → stored art) | – | – | – | dialog closes | JS-only | No Escape or focus handling (C02-A34) |
| Transfer approval dialog | "Try again" | 629-636 | transferDesign(cached b64) | POST /api/design-transfer | another art PNG | server | scanning | scanError | disabled={scanning} | JS-only | Orphaned art PNGs (C02-A27) |
| Transfer approval dialog | "Cancel" | 637-643 | setTransfer(null) | – | – | – | – | – | – | JS-only | Art PNG is left orphaned |
| CCD | "↶ Undo" (fine-tune) | 681-688 | runUndo | – | LS→save | – | – | – | disabled when nothing to undo | JS-only | |

### 3b. FreeCardEditor (`src/components/FreeCardEditor.tsx`; all LS→save)

Gating for this whole section: `customLayout` is kept only for paid accounts. POST strips it, PATCH downgrades the custom template, and the render strips it.

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FCE | Card canvas (role=application, tabIndex 0): tap to select, drag to move | 337-348, 157-207 | pointer handlers; one commit on release | – | LS→save | see above | – | – | – | JS-only | Selection needs a pointer (C02-A30) |
| FCE | Resize corner dot (title "Drag to resize") | 359-364 | resize drag | – | LS→save | – | – | – | – | JS-only | Not focusable, no name, inside aria-hidden (C02-A30) |
| FCE | Keyboard on canvas: Arrows (Shift ×4), Delete / Backspace, Escape | 210-224 | update / remove / deselect | – | LS→save | – | – | – | – | JS-only | Does nothing unless something is selected (C02-A30) |
| FCE | "Done" | 380-384 | deselect | – | – | – | – | – | – | JS-only | |
| FCE | "↶ Undo" | 385-392 | undo.run | – | LS→save | – | – | – | disabled | JS-only | |
| FCE | "−" / "+" (aria "Smaller" / "Bigger") | 401-402 | scaleEl (bounded) | – | LS→save | – | – | – | – | JS-only | |
| FCE | 6 font chips (Sans, Display, Serif, Elegant, Mono, Rounded) | 411-417 | update({font}) | – | LS→save | – | – | – | – | JS-only | No aria-pressed (C02-A31) |
| FCE | Bold / Italic / CAPS | 423-429 | update | – | LS→save | – | – | – | – | JS-only | aria-pressed is set |
| FCE | Align Left / Centre / Right | 435-438 | setAlign | – | LS→save | – | – | – | – | JS-only | No aria-pressed |
| FCE | "Text" input (maxLength 120) | 444-450 | update({text}) on every keystroke | – | LS→save | – | – | – | – | JS-only | **No accessible name** (C02-A31); one undo entry per keystroke (C02-A37) |
| FCE | Element colour: up to 14 swatches + "Any colour" | 299-328, 455 | update({color}) | – | LS→save | – | – | – | – | JS-only | Swatches named by hex (C02-A31) |
| FCE | Frame: Circle / Rounded / Square | 464-470 | update({frame}) | – | LS→save | – | – | – | – | JS-only | |
| FCE | Shape colour swatches + "Any colour" | 477-480 | update({fill}) | – | LS→save | – | – | – | – | JS-only | |
| FCE | "See-through" range (aria "Opacity", 10-100) | 483-491 | setLive; commit on pointer-up / key-up | – | LS→save | – | – | – | – | JS-only | C02-A33 |
| FCE | Move ← → ↑ ↓ (aria "Move left/right/up/down") | 499-502 | update x/y ±1 | – | LS→save | – | – | – | – | JS-only | |
| FCE | "Bring forward" / "Send back" | 509-510 | reorder | – | LS→save | – | – | – | disabled at the ends | JS-only | |
| FCE | "Remove from card" | 514-516 | remove | – | LS→save | – | – | – | – | JS-only | Undoable |
| FCE | "Remove artwork" | 527-529 | commit({bgImage:undefined}) | – | LS→save | – | – | – | – | JS-only | Stored PNG is orphaned |
| FCE | Background palette + 12 swatches + "Any colour" | 535-539 | commit({background}) | – | LS→save | – | – | – | – | JS-only | |
| FCE | 6 whole-card font chips | 544-555 | commit({fontFamily}) | – | LS→save | – | – | – | – | JS-only | |
| FCE | "Add to card" chips (each field, Photo, Logo, QR code, each social, Text, Line, Box, Circle) | 263-290, 565-567 | add() | – | LS→save | – | – | – | – | JS-only | **No 40-element cap (C02-A32)** |

### 3c. TemplatePicker, TemplateStyleControls, DesignControls

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TemplatePicker | 6 template tiles ("Classic Pro", "Modern Bold", "Photo First", "Local Business", "Luxury Minimal", "Logo First") | TemplatePicker.tsx:94-101,158-162 | onSelect(id) | – | LS→save (cards.template) | all | – | – | – | JS-only | aria-pressed |
| TemplatePicker | "Custom design" / "Custom design (Pro, locked)" | :165-167 | onSelect("custom") | – | LS→save | UI customUnlocked + server rewrite (POST :111, PATCH :109) | – | – | disabled when locked | JS-only | |
| TemplatePicker (CEF, Free) | "Make it unmistakably yours — unlock the custom designer with Pro →" | :170 → CustomDesignCard.tsx:59 | Link /upgrade | – | – | Free | – | – | – | Yes | Drops unsaved edits (C02-A39) |
| TSC | Step 1 Look: "Original" tile + one tile per Look | TemplateStyleControls.tsx:111-173 | applyOriginal / applyLook | – | LS→save | PRO tag for Pro finishes; POST snaps; PATCH keeps; render strips | – | – | – | JS-only | |
| TSC | Colour steps (Background, Surface / Branding panel, Name / Text, Title, Company, Accent, Details / Info): preset swatches | :195-216, 587-591, 652-675 | onChange({key}) | – | LS→save | Presets: all plans | – | – | – | JS-only | Every swatch is labelled "Color preset" (C02-A31) |
| TSC | "any color" `type=color` (PRO tag) in each step | :217-246 | onPick | – | LS→save | Pro: UI + Save dialog + render snap | – | – | – | JS-only | |
| TSC | "Default" in each step | :247-261 | onPick(undefined) | – | LS→save | – | – | – | – | JS-only | |
| TSC | Photo First "Photo shape" Segmented (Original / Circle) | :608-616 | onChange({photoShape}) | – | LS→save | all | – | – | – | JS-only | |
| TSC | "Add a photo or video" / "Replace" (PRO tag) + hidden input | :484-486, 508-515, 465-471 | pick() → uploadMedia("cardbg"); for video, also a poster frame | POST /api/upload (cardbg, defer); POST /api/upload/link-video + PUT signed URL + poster POST | card-uploads; panelMedia* (LS→save) | **UI tag only; no server plan check on upload (C02-A28)** | "Uploading…" | role=alert (518) | busy | JS-only | Video is orphaned if the poster fails (C02-A27) |
| TSC | "Remove" (media) | :487 | clears panelMedia* + panelDim | – | LS→save | – | – | – | disabled while busy | JS-only | |
| TSC | "Darken so your name reads" range (0-85) | :490-505 | onChange({panelDim}) | – | LS→save | Pro key | – | – | – | JS-only | Hard-coded id="panel-dim" (C02-A64) |
| TSC | Font pills ("Default" + CARD_FONT_OPTIONS) | :266-288, 680 | onChange({fontFamily}) | – | LS→save | Listed as Pro; server deliberately keeps it (plan.ts:205-208) | – | – | – | JS-only | |
| TSC | Finish tiles (CARD_FINISHES) | :321-357 | onChange({finish}) | – | LS→save | Pro finishes: UI tag; server drops them to Flat on POST and at render | – | warning (362-366) | – | JS-only | |
| DesignControls | Segmented (role=group, aria-pressed) | DesignControls.tsx:161-205 | onChange | – | caller's state | – | – | – | – | JS-only | |
| DesignControls | Switch (role=switch, aria-checked) | :214-257 | onChange(!checked) | – | caller's state | – | – | – | disabled + title | JS-only | |
| DesignControls | MoreOptions `<details>` | :267-305 | native | – | – | – | – | – | – | **Yes** | |

---

## 4. Image upload, crop, logo and photo-suggest modals

These are shared by the wizard, the Edit card page and Office Branding.

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ImageUpload | Tile button "Upload …" / "Change …" (aria) | ImageUpload.tsx:230 | inputRef.click() | – | – | – | – | – | Not disabled while uploading (the modal covers it) | JS-only | |
| ImageUpload | "Upload" / "Change" / "Uploading…" | :262 | inputRef.click() | – | – | – | yes | – | disabled while uploading | JS-only | |
| ImageUpload | "Adjust" | :271 | adjustCurrent → fetch(preview,{mode:"cors"}) → crop | GET image URL | – | – | **no loading state** | "Couldn't open that photo…" | no | JS-only | Fails for hotlinked logos (C02-A18) |
| ImageUpload | "Remove" | :280 | handleRemove (deferred uploads: local only) | DELETE /api/upload only when not deferred | – (null on save) | – | – | – | – | JS-only | No confirm; undoable |
| ImageUpload | Hidden `<input type=file accept=jpeg,png,webp>` | :296 | handleFileSelect → createObjectURL | – | – | – | – | – | – | JS-only | No client-side type or size check (C02-A46) |
| Crop modal | "Cancel" / Esc | CropperLazy.tsx:87,72 | onCancel → cancelCrop (revokes the URL) | – | – | – | – | – | **enabled while busy** | JS-only | A cancelled image is still applied (C02-A44) |
| Crop modal | "Apply" / "Saving…" / Enter | CropperLazy.tsx:91,68 | handleApply → cropToCanvas → applyCrop | POST /api/upload (field, defer, card_id) | storage card-uploads (no row while deferred) | Auth only; server checks type and size | "Saving…" | in the modal | busy + closure guard, with an async gap (C02-A45) | JS-only | No `.catch` on cropToCanvas (C02-A46) |
| Crop modal | Aspect "Square" / "Wide" / "Banner" (logo) | CropperLazy.tsx:141 | onAspectChange | – | – | – | – | – | – | JS-only | The choice carries over to the next crop |
| Crop modal | Crop rectangle drag / resize handles | CropperLazy.tsx:114 | ReactCrop onChange / onComplete | – | – | – | – | – | – | JS-only | With a broken image, Apply silently does nothing (C02-A46) |
| LogoSuggest | "Suggest my company logo" | LogoSuggest.tsx:80 | find() | POST /api/logo-suggest | none (Logo.dev + site fetch; rate-limited) | – | "Searching official logos…" | emptyMessage | hidden while loading | JS-only | |
| LogoSuggest | Candidate rows (name / domain) | :114 | choose → onConfirm(c.logoUrl) | – | logo_url / brand_logo_url on save (third-party URL) | – | – | – | – | JS-only | C02-A18. The "Applied X's logo" note stays after the logo changes |
| LogoSuggest | "None of these" | :138 | setState(idle) | – | – | – | – | – | – | JS-only | |
| ProfilePhotoSuggest | "Suggest my profile picture" | ProfilePhotoSuggest.tsx:413 | suggest() | GET /api/photo-suggest; GET /api/integrations/linkedin | integrations.sync_error may be updated | – | "Looking for your headshot…" | yes | hidden while loading | JS-only | |
| ProfilePhotoSuggest | "Tip: connect your LinkedIn" (mobile), "Connect LinkedIn" / "Reconnect LinkedIn" | :430, :501, :513 | connectLinkedIn → popup / Capacitor Browser / location.href fallback | GET /api/integrations/linkedin/connect; POST /api/integrations/handoff (native) | integrations (via OAuth callback) | – | – | via the return leg | nonce | **Yes (`href`): leaves the page** | C02-A47, A48 |
| ProfilePhotoSuggest | Candidate "Use this photo" (Google / Gravatar / LinkedIn) | :475 | importPhoto | POST /api/photo-suggest or POST /api/integrations/linkedin | storage card-uploads | – | "Adding your photo…" | yes | hidden while applying | JS-only | The LinkedIn POST has no rate limit (C02-A50) |
| ProfilePhotoSuggest | "Retry" / "Cancel" | :462, :529 | suggest / setState(idle) | as suggest | – | – | – | – | – | JS-only | The LinkedIn "error" state renders nothing |
| ProfilePhotoSuggest (auto) | OAuth return (`?integration=linkedin`) + postMessage / storage listener | :189-206, 218-273 | finishLinkedInReturn | POST /api/integrations/linkedin | card-uploads | – | "Adding your photo…" | yes | nonce cleared | – | C02-A47 |

---

## 5. Swift Links editor (Socials and Social design tabs; Office Links tab; /share)

Where each component is mounted:

- **SwiftLinkStyleControls:** CEF:1475, W:2337, OfficeLinksBranding:322, SwiftLinkMiniBuilder:160, TeamsDashboard:1017.
- **LinkButtonsControls:** inside SwiftLinkDesign:1027, and directly at CEF:1470 and W:2332.
- **AddLinkForm:** CEF:1405, W:2031, OfficeLinksBranding:283, BuilderFields, TeamsDashboard:995.
- **SwiftLinkProfile and SwiftLinkButtons:** the public page and the preview only, with no owner editing controls.
- **Reorder:** there is no drag or arrow control for reordering links anywhere in the repo.

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 Page header | Header style (Cover / Banner / Avatar / None) | SwiftLinkDesign.tsx:851 | onChange({linkHeroStyle}) | LS→save | customization.linkHeroStyle | all | – | – | – | JS-only | No aria-pressed |
| 1 Page header | Header shows: Auto / Photo / Logo / Initials | :888 | linkHeroContent | LS→save | customization | all | – | – | – | JS-only | |
| Header upload | "+ Upload photo or video" (+ input :568) | :614 | pick() → uploadMedia("hero") | POST /api/upload (hero, defer) or POST /api/upload/link-video + PUT | card-uploads; linkHeroImage | all; guests allowed | "Uploading…" | red text | disabled={busy} | JS-only | Save is not blocked during the upload (C02-A22) |
| Header upload | "Use it" / "Replace" / "Remove" | :596, :600, :604 | set content / pick / clear | LS→save (Replace uploads again) | customization | all | Replace: yes | Replace: yes | busy | JS-only | The old object is never deleted (C02-A27) |
| 2 Look | Family rows (Solid / Gradient / Glass) accordion | :344 | toggle | – | – | PRO tag | – | – | – | JS-only | aria-expanded without aria-controls |
| 2 Look | Look swatches (title = look name) | :174 | onPick → linkLook (clears bg, text, button, accent) | LS→save | customization.linkLook | Free: Paper and Onyx; the rest Pro (render snap + Save dialog) | – | Pro dialog | – | JS-only | On Free the Edit card preview does not change (C02-A21) |
| 3 Background | Presets ("Color preset" ×7) / custom colour / "Default" | :128, :139, :147 | linkBgColor | LS→save | customization.linkBgColor | Pro (LINK_STYLE_KEYS; render strip + dialog) | – | dialog | – | JS-only | The custom input is labelled "Accent colour" (C02-A31) |
| 3 Background media | "+ Add photo or video" / "Replace" (+ input :683) | :721 | pickFile → uploadMedia("pagebg") | POST /api/upload or link-video + PUT | card-uploads; linkBgMedia / Type / linkGlass | PRO tag only; **no server plan check on upload** | yes | yes | busy | JS-only | C02-A28 |
| 3 Background media | "Remove" | :730 | clears linkBgMedia | LS→save | customization | Pro | – | – | – | JS-only | Object is orphaned |
| 3 Background media | "Darken the background" range | :760 | linkBgDim | LS→save | linkBgDim | Pro | – | – | – | JS-only | |
| 3 Text colour | Presets / custom / Default | :128/:139/:147 (via :949) | linkTextColor | LS→save | linkTextColor | Pro | – | dialog | – | JS-only | |
| 4 Font | "Default" + CARD_FONT_OPTIONS | :970 | linkFontFamily | LS→save | linkFontFamily | Pro | – | dialog | – | JS-only | No aria-pressed |
| 5 Social icons | Shape buttons / Fill buttons | :496 / :514 | linkIconShape / linkIconFill | LS→save | customization | Pro | – | dialog | – | JS-only | |
| 6 Connect button | Presets / custom / Default | :1010 | linkAccentColor | LS→save | linkAccentColor | Pro | – | dialog | – | JS-only | |
| 7 Link buttons | Solid / Outline row colour: presets / custom / Default | :1035 | linkButtonColor | LS→save | linkButtonColor | Pro | – | dialog | – | JS-only | |
| 7 Per link | Size: Featured / Grid / Compact | LinkButtonsControls.tsx:248 | patch(i,{size}) | LS→save | links[i].size | Pro at render + dialog | – | dialog | – | JS-only | On Free, tapping the default Grid writes it and triggers the Pro dialog (C02-A65) |
| 7 Per link (Compact) | Row style: Standard / Solid / Outline | LinkButtonsControls.tsx:266 | patch(i,{rowStyle}) | LS→save | links[i].rowStyle | **Not gated anywhere (C02-A19)** | – | none | – | JS-only | |
| 7 Per link (Featured / Grid) | "Upload photo or video" / "Replace" (+ input :101) | :130 | pickFile → uploadMedia("link") → onChange({media}) | POST /api/upload (link) or link-video + PUT | card-uploads; links[i].media | Pro at render; upload not gated | yes | yes | busy | JS-only | **Stale-closure overwrite (C02-A20)** |
| 7 Per link | "Use link preview" | :139 | media → undefined | LS→save | links[i].media | Pro | – | – | – | JS-only | Object is orphaned |
| 7 Per link | "Blur" switch | :290 | patch(i,{glass}) | LS→save | links[i].glass | Pro at render + dialog | – | dialog | – | JS-only | |
| 7 Per link | Preview thumbnail (automatic) | LinkPreviewThumb via :228/:236 | fetchLinkPreview | GET /api/link-preview, /api/link-icon, /api/img-proxy | – | – | fallback stages | silent | – | JS-only | SSRF-guarded (safeFetch) and rate-limited |
| Additional links | Idea chips (Book a meeting, Leave a review, See my listings, Watch my video, Shop now) | AddLinkForm.tsx:80 | fill label, focus URL | – | – | – | – | – | – | JS-only | |
| Additional links | "Button text" | AddLinkForm.tsx:105 | onChange | – | – | – | – | – | – | controlled | No maxLength (C02-A49) |
| Additional links | "Web address" (Enter adds) | AddLinkForm.tsx:117 | onChange / Enter → onAdd | – | – | – | – | **no validation** | – | controlled | C02-A24 |
| Additional links | "+ Add link" | AddLinkForm.tsx:133 → CEF:452 / W:840 | addLink (adds https:// unless http(s)) | LS→save | customization.links | Free cap of 2: UI; server only on POST | – | – | disabled until both fields are filled | JS-only | C02-A23, A25 |
| Office Links | "Company" tag on company rows | LinkButtonsControls ~:215; CEF:1377 | – | – | Server re-pins via overlayOfficeLinks | Office | – | – | – | – | Not a control |
| /share LinksPageTabs | "Swift Links" / "Swift Signature" / "Create +" tabs (Arrow / Home / End) | LinksPageTabs.tsx:124 | select() + hash | – | URL hash | – | – | – | – | JS-only | Keyboard support is OK |
| /share | "Open your Swift Links page" overlay; "Open Swift Links →" | share/page.tsx:229, :246 | `<a>` via /api/self-view | GET /api/self-view | – | – | – | – | – | Yes | |
| /share | Copy (CopyButton) | share/page.tsx:244 | clipboard | – | – | – | – | prompt fallback | – | JS-only | |
| /share | "Edit my links" | share/page.tsx:250 | Link /cards/{id}/edit?tab=sharing | – | – | – | – | – | – | Yes | |
| /share Create + | Paste box (contentEditable, "Paste your signature, text or a picture here") / drag-drop | CreateLinkBox.tsx:326, :318 | onPaste / onDrop → make() | POST /api/upload field=create | card-uploads/{uid}/create-*; localStorage sc_create_{username} | **Pro: UI (share:288) + server (upload :101-104)** | "Linking it to your card…" | role=alert | phase → working | JS-only | |
| /share Create + | "Paste" / "Choose a picture" (+ input :350) | CreateLinkBox.tsx:342, :346 | make() | same | same | Pro (both) | yes | yes | phase | JS-only | |
| /share Create + | "Copy" / "Copied ✓…" / "Couldn't copy — tap to try again" | CreateLinkBox.tsx:282 | copy() (ClipboardItem) | – | – | Pro | – | yes | – | JS-only | |
| /share Create + | "Start over" | CreateLinkBox.tsx:290 | startOver | – | clears localStorage | Pro | – | – | – | JS-only | Uploaded objects stay in storage |

---

## 6. Office Branding, Office per-card page, admin Create card, and the share / QR / signature / wallet modals

### 6a. Office Branding (`/office/admin/branding`)

Guards:
- **Page:** `requireOfficeAdmin` + `caps.canBrand`.
- **Server** (`api/office/brand/route.ts:24-32`): `manage_branding` (owner or admin) + Office plan.

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Branding | Tabs "Card" / "Links" (role=tab) | OfficeBranding.tsx:240-253 | setTab + hash | – | – | canBrand (both) | – | – | – | JS-only | Both panels stay mounted |
| Card tab | ImageUpload "Company logo" (Upload / Change, Adjust, Remove, file input) | :274 | deferred upload | POST /api/upload | card-uploads | auth | "Uploading…" | yes | disabled | JS-only | §4 |
| Card tab | LogoSuggest (+ candidates, "None of these") | :277 | find / choose | POST /api/logo-suggest | – | – | yes | yes | hidden | JS-only | The hotlinked URL is pushed to every team card (C02-A18) |
| Card tab | Segmented "Logo shape on the card" | :281 | setLogoShape | LS→save | offices.brand_design.logoShape | both | – | – | – | JS-only | |
| Card tab | Company name / Website / Main phone / Fax inputs | :297, :301, :310, :317 | setState | LS→save | offices.brand_company / website / phone / fax → cards | both | – | – | – | JS-only | Labels are not associated with the inputs (C02-A61) |
| Card tab | Address: Street / Unit / City / State / ZIP | :326-330 | setAddr | LS→save | offices.brand_address → cards.customization | both | – | – | – | JS-only | |
| Card tab | TemplatePicker | :365 | setTemplate | LS→save | offices.brand_template (cards.template when locked) | both | – | – | – | JS-only | |
| Card tab | CustomCardDesigner (teamBrand) | :370 | setCustomLayout | /api/scan-design, /api/design-generate | brand_custom_layout | server (paid) | §3 | §3 | §3 | JS-only | |
| Card tab | TemplateStyleControls | :374 | patchDesign | LS→save | offices.brand_design | both | – | – | – | JS-only | |
| Card tab | Checkbox "Keep every card matching" | :418 | setLockTemplate | LS→save | offices.brand_locks.template | both | – | – | – | JS-only | |
| Card tab | **"Save & apply to team cards"** | :434 (save 169-192) | save() | **PATCH /api/office/brand** | offices row; team cards (logo_url, company, website, template, label, customization, instagram); notifications (after()); audit; card-shares / card-signatures removed; wallet touch | **both** | "Saving…" | generic "Something went wrong" (server message dropped) | disabled + state | JS-only | C02-A01 to A04 |
| Links tab | Textarea "Bio" | OfficeLinksBranding.tsx:198 | setBio (max 500) | LS→save | offices.brand_link_bio | both | – | – | – | JS-only | |
| Links tab | SocialHandleField "Company Instagram" | :218 | setInstagram | LS→save | offices.brand_link_instagram | both | – | Field hint; Save only refocuses (:123-126) | – | JS-only | Save on invalid input says nothing (Suspected, C02-A05) |
| Links tab | Section header title input | :243 | setLinks | LS→save | offices.brand_links | both | – | – | – | JS-only | The server drops empty headers (:170) |
| Links tab | × Remove section / × Remove {label} | :250, :269 | filter | – | – | – | – | – | – | JS-only | No confirm, yet it changes every member's page |
| Links tab | AddLinkForm (chips, "Button text", "Web address", "+ Add company link") | :283 | addLink | LS→save | brand_links | both | – | – | disabled until filled | JS-only | No cap in the UI; the server keeps 20 (C02-A05) |
| Links tab | "+ Add a section header" | :296 | push header | LS→save | brand_links | both | – | – | – | JS-only | |
| Links tab | SwiftLinkStyleControls | :322 | patchStyle / setLinks | LS→save | offices.brand_link_design, brand_links | both | – | – | – | JS-only | §5 |
| Links tab | Checkbox "Keep every Swift Links page matching" | :363 | setLockLinkDesign | LS→save | offices.brand_locks.linkDesign | both | – | – | – | JS-only | |
| Links tab | **"Save & apply to team Swift Links"** | :380 (save 119-144) | save() | **PATCH /api/office/brand** | as above + releaseOfficeLinks | both | "Saving…" | "Couldn't save — try again" (no role) | yes | JS-only | C02-A01 |

### 6b. Office per-card page (`/office/admin/cards/[id]`)

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Per-card | "← Back" | page.tsx:29 | Link | – | – | – | – | – | – | Yes | |
| Per-card | "View card ↗" | OfficeCardActions.tsx:90 | `<a target=_blank>` | GET /{username} | – | – | – | – | – | Yes | |
| Per-card | "Edit details" / "Cancel" | :98 | toggle editing | – | – | UI | – | – | – | JS-only | Cancel does not reset the draft (C02-A08) |
| Per-card | "Take offline" / "Cancel" / "Bring back online" | :104 | toggleOffline | PATCH /api/office/cards/{id} {is_offline} | cards.is_offline; notifications; audit_log | both | label | yes (:87) | disabled={busy} | JS-only | No wallet touch (C02-A06) |
| Per-card | "Yes, take it offline" / "Go back" | :128, :136 | setOfflineTo(true) / close | same | same | both | "Taking offline…" | yes | busy | JS-only | |
| Per-card | Name / Title / Email / Phone inputs | :154 | setDraft | – | – | – | – | – | – | JS-only | No type, format or length check (C02-A07) |
| Per-card | "Save changes" | :163 | save → patch(draft) | PATCH /api/office/cards/{id} | cards name / title / email / phone, customization.phones; card-shares (+ card-signatures) removed; signature_stale notification | both | "Saving…" | server message | busy | JS-only | C02-A06, A07 |

### 6c. Admin "Create card for business" (`/admin/users`, `UsersClient.tsx`)

The server checks `requireAdmin()` on create-card, set-plan, users and export.

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Users | "Export CSV" | UsersClient.tsx:187 | `<a href>` | GET /api/admin/users/export | – | admin (server) | – | – | – | Yes | |
| Users | "+ Create card for business" | :193 | open modal | – | – | admin | – | – | – | JS-only | |
| Users | Plan chips "All / Free / Pro / Office · n", sort select, search | :205, :216, :223 | local filter over the loaded list | GET /api/admin/users (load) | – | admin | "Loading…" | **none** (C02-A10) | – | JS-only | |
| Users | Table row click | :254 | router.push(/admin/users/{id}) | – | – | admin | – | – | – | JS-only | No keyboard access (C02-A64) |
| Users | PlanBadge select (Free / Pro / Office) | :89 (setPlan 72-81) | setPlan | PATCH /api/admin/set-plan | profiles.plan (+ customization) | admin (server) | disabled while saving | **none** (C02-A09) | disabled | JS-only | |
| Users | "Card ↗" / "Links ↗" | :281-282 | `<a>` | – | – | – | – | – | – | Yes | |
| Modal | Backdrop / "✕" | :298 / :302 | setShowCreate(false) | – | – | – | – | – | – | JS-only | No Escape, role=dialog or focus handling; ✕ has no label (C02-A34) |
| Modal | Full name*, Email*, Username*, Company, Title, Phone | :339 | setForm | – | – | – | – | HTML `required` | – | JS-only | No `name` attributes, so a pre-hydration submit is a harmless GET |
| Modal | Selects: Plan, Card template, Photo (photo-first only) | :351, :360, :376 | setForm | – | – | – | – | – | – | JS-only | The server accepts "custom", but it is not offered here |
| Modal | "Colour behind photo" presets / "Any color" / "Default" | :386, :391, :394 | setForm.surfaceColor | – | – | – | – | – | – | JS-only | Presets are all named "Color preset" |
| Modal | "Title color" / "Company color" rows (presets, any colour, Default) | :405, :408 (LineColorRow 28,33,36) | setForm | – | – | – | – | – | – | JS-only | Server validates them as hex |
| Modal | "Accent color" picker | :414 | setForm | – | – | – | – | – | – | JS-only | Not validated by the server (C02-A13) |
| Modal | **"Create card"** | :419 (createCard 151-174) | fetch | **POST /api/admin/create-card** | auth.users (createUser); profiles insert (a legacy profile-card; the cards row is created by ensure-cards on the first dashboard visit); email_preferences; recovery email | admin (server) | "Creating…" | server message (a non-JSON reply shows "Network error") | disabled={creating} | JS-only | C02-A11, A12, A13 |
| Modal success | Card URL link / "Done" | :313, :317 | `<a>` / close | – | – | – | – | – | – | – | Always says the email was sent (C02-A11) |

### 6d. Share, QR, signature, wallet and download modals

| Surface | Control | file:line | Handler | API | Written | Gating | Load | Err | DS | PreH | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| QRCodeModal | "Show QR Code" (label varies) | QRCodeModal.tsx:68 | openPopup | – | – | none | – | – | – | JS-only | Opens in contact mode when offline |
| QRCodeModal | Backdrop / Escape | :92, :43 (useDialogA11y) | setOpen(false) | – | – | – | – | – | – | – | No visible close button; only "Tap outside to close" |
| QRCodeModal | "Card link" / "Contact · no signal" | :127 | setMode | – | – | – | – | – | – | – | Blank tile if the MiniQR chunk fails to load (catch swallowed at :53) |
| ShareButton | "Share Card" (label prop) | ShareButton.tsx:142 | handleShare: native → navigator.share → clipboard | warmSharePreview (same-origin GET) | – | – | – | window.prompt fallback | "Link copied!" disabled for 2.5 s | JS-only | Focus is lost when the button swaps (Suspected) |
| MoreShareOptions | "Other ways to share" / "×" Close / backdrop | MoreShareOptions.tsx:46, :62, :58 | open / close | – | – | – | – | – | – | JS-only | role=dialog + useDialogA11y |
| AddToWalletButton | "Add to Apple Wallet" `<a>` / QR tile / Mac note | AddToWalletButton.tsx:113 / :103 / :88 | link (Capacitor Browser in the app) | GET /api/wallet/pass?card= | wallet registry fingerprint | Public; 120 per 10 min per IP; isCardActive | – | **raw JSON on error (C02-A14)** | – | **Yes** | |
| DownloadCardButton | "Download card (PNG)" / "Download card as image" | DownloadCardButton.tsx:92 / :112 | captureCardPng → save | – | client-side file | – | "Saving…" | "Couldn't save — retry" | disabled while working | JS-only | Does nothing silently if cardRef is null |
| QRDownloadButton | "Download QR (PNG)" | QRDownloadButton.tsx:54 | renderQrPng → save | – | – | – | **none** | **none (catch {})** | **none** | JS-only | C02-A15 |
| CardPreviewDownload | Card tap "Show your card full screen" (phones) | CardPreviewDownload.tsx:117 | opens CardFullscreen (Escape, Close) | – | – | – | – | – | – | JS-only | No longer has a download control; the name is stale |
| CopyButton | "Copy" / "Copied!" | CopyButton.tsx:21 | clipboard.writeText | – | – | – | – | prompt fallback | – | JS-only | |
| EmailSignatureBox (/share) | Preview image link / "Contact me" | EmailSignatureBox.tsx:532, :533 | `<a target=_blank>` | – | – | – | "Generating your card…" | "Couldn't generate your card…" | – | Yes | |
| EmailSignatureBox | **"Copy signature"** | :539 (copy 444-481; auto-capture 345-401) | capture → POST → ClipboardItem | POST /api/card-signature | storage card-signatures/{username}.png; localStorage sc_sighash / sc_sigurl / sc_sigcopied | Auth + ownership; no plan gate | "Generating from your card…" / "Copying…" | "Couldn't copy — tap to try again" | disabled + captureRef | JS-only | C02-001, 002, 010; C02-A16; C02-A12 (slugs over 40 characters) |
| EmailSignatureBox | "Gmail" / "Outlook" / "Yahoo" / "Open it here" | :569, :588 | `<a target=_blank>` | external | – | – | – | – | – | Yes | |

---

## Control count per surface

Counts are table rows. A row that groups repeated, identical controls (for example "7× SocialHandleField" or "each phone row") counts once.

| Surface | Rows |
|---|---|
| Wizard `/cards/new` (entry, resume, navigation, steps 1–5, plan gate, FreeDesignChoice, GuestGate, background) | 79 |
| Edit card page (CardEditForm + CardUrlEditor + Pro dialog) | 58 |
| Card designer (CCD 17, FreeCardEditor 21, TemplatePicker / TSC / DesignControls 16) | 54 |
| Upload / crop / logo / photo-suggest modals | 17 |
| Swift Links editor (+ /share link tools) | 34 |
| Office Branding (Card + Links tabs) | 20 |
| Office per-card page | 7 |
| Admin Create card + users console | 14 |
| Share / QR / wallet / signature / download modals | 13 |
| **Total** | **296** |

---

## Defects surfaced by the inventory

These are new defects only; C02-001 to C02-013 are not repeated. Each defect is marked **Confirmed** (by code trace at HEAD) or **Suspected**, and **✔** means it was also re-checked by hand during assembly.

### Data integrity and wrong success signals

- **C02-A01 ✔ Office brand save reports success after saving only part of the change.** High. Confirmed.
  - **Where:** `src/app/api/office/brand/route.ts:201-215`.
  - **What happens:** if the full `offices` update fails for any reason, the route retries without the link columns, then with only logo, company, website and template. If a retry succeeds, the route carries on and returns ok. "Applied ✓" can therefore show while phone, fax, address, design, locks, or every Swift Links field was dropped.
  - **Cause:** the fallback was written for a missing-column migration but is not limited to that error.
- **C02-A02 ✔ Brand propagation skips the `profiles.office_id` check.** High. Confirmed.
  - **Where:** `src/lib/office-brand.ts:636-650`.
  - **What happens:** `propagateBrandToOfficeCards` targets every `office_members.status='active'` row except the owner, without the `profiles.office_id` check the route's first pass uses (route:217-245). A departed member whose membership row was never cleaned up gets this office's design, links and Instagram written over their own card.
  - **Why it matters:** the route's own comment says a stale membership row must never trigger a rebrand.
- **C02-A03 Brand propagation writes ignore errors.** Medium. Confirmed that writes are unchecked; impact Suspected.
  - **Where:** route.ts:257, 264, 275, 289, 293; office-brand.ts:654-658.
  - **What happens:** errors are unchecked or caught and swallowed, so some team cards can keep the old brand while the admin sees ✓.
- **C02-A04 Brand propagation can time out on large teams.** Medium. Suspected.
  - **Where:** route.ts:270-347.
  - **What happens:** propagation runs serially inside the request (per card and per member, plus storage removals and a wallet push per slug). On a large team the function can time out after the `offices` row is saved. The client shows "Something went wrong" while propagation is half done. Retrying is safe because the work is idempotent.
- **C02-A05 Office company links: the UI has no limit, but the server keeps only 20.** Low. Confirmed (Instagram part Suspected).
  - **Where:** `OfficeLinksBranding.tsx:111-117` vs route.ts:172.
  - **What happens:** the server silently keeps the first 20 links and drops empty headers (:170). The form is not reloaded, so it keeps showing links that were never stored.
  - **Also:** Save with an invalid Instagram only refocuses the field (:123-126), with no message.
- **C02-A06 Office admin card edits don't refresh Wallet passes.** Low. Confirmed.
  - **Where:** `src/app/api/office/cards/[id]/route.ts`.
  - **What happens:** name, phone and email edits and offline/online changes never call `touchWalletPass` / `refreshCardSurfaces`. The owner route (`api/cards/[id]/route.ts:368`) and the brand save both do. Installed passes stay stale until the daily `/api/wallet/sweep`.
- **C02-A07 Office per-card PATCH validates nothing.** Medium. Confirmed.
  - **Where:** `api/office/cards/[id]/route.ts:46-51`; `OfficeCardActions.tsx:154`.
  - **What happens:**
    - Raw `body[key]` values of any JSON type go into `cards`, with no format or length check (an email of "asdf" is accepted).
    - Client `customization` is merged with no key allow-list.
    - `req.json()` is uncaught, so bad JSON returns a 500.
  - **Related:** overlaps C02-005 for an empty name.
- **C02-A08 Office per-card "Cancel" keeps abandoned edits.** Low. Confirmed.
  - **Where:** `OfficeCardActions.tsx:98-103`.
  - **What happens:** Cancel does not reset `draft`, so reopening "Edit details" shows the abandoned edits.
- **C02-A20 A per-link media upload overwrites the link list with a stale copy.** Medium. Confirmed.
  - **Where:** `LinkButtonsControls.tsx:186` (the patch closure captures the `links` prop), awaited in `pickFile` (:81-92). Rows are keyed by index.
  - **What happens:** any edit made while the upload runs is reverted when it finishes. A removed link can come back, or the media can land on the wrong row.
- **C02-A22 Save and Create are not blocked while an upload is in flight.** Medium. Confirmed.
  - **Where:** the `busy` flag is local to HeroMediaUpload, PageBackgroundMedia, LinkMediaControl and TSC media; neither CEF:1543 nor W:2408 checks it.
  - **What happens:** saving mid-upload stores the old value, and the new URL is lost unless the user saves again.
- **C02-A40 ✔ Text typed before hydration is saved stale in most Edit card fields.** Medium. Confirmed (wizard part Suspected).
  - **Where:** CEF:261-269 recovers only name, company, title, email, website and bio.
  - **Not recovered:** nickname (CEF:1081), phone number and label (CEF:991, 1001), fax (1071), address, the 7 social handles, and section titles.
  - **What happens:** what the user typed stays visible in the DOM, but Save sends the old value. This is the exact failure the code comment says was measured in production.
  - **Wizard:** it has no recovery step at all, and its silent draft restore (W:975-976) can overwrite early keystrokes.
- **C02-A41 Dirty tracking misses changes that aren't typed.** Medium. Confirmed.
  - **Where:** CEF:407 and :856.
  - **Missed changes:**
    - "On card" toggle (1009)
    - Remove number (1021) and "+ Add number" (971)
    - Remove link or section (1366, 1384)
    - "+ Add a section header" (1413)
    - LinkedIn paste and "Paste my link" (SocialHandleField ~380, 236)
  - **What happens:** after only these changes, Cancel leaves without asking and closing the tab gives no prompt.
- **C02-A42 Save is enabled again during the "Saved!" window.** Low. Confirmed.
  - **Where:** CEF:1545.
  - **What happens:** the button is disabled only while saving. During the 1 s before `router.push` (CEF:731), a second tap sends another PATCH and queues another navigation.
- **C02-A44 Cancelling the crop during an upload still applies the image.** Medium. Confirmed.
  - **Where:** CropperLazy.tsx:87 and :72 stay enabled while busy. ImageUpload.tsx:109-114 `cancelCrop` does not abort, and :151-155 still calls `onUploaded`.
- **C02-A45 Crop Apply can upload twice.** Low. Suspected.
  - **Where:** CropperLazy.tsx:59-64; ImageUpload.tsx:117.
  - **What happens:** two fast Apply or Enter presses can both reach `applyCrop` before the re-render, giving two uploads.
- **C02-A46 An undecodable file fails silently in the crop step.** Low. Confirmed.
  - **Where:** ImageUpload.tsx:99-107 and :299 (`accept` only, no type or size check); CropperLazy.tsx:61 and :63 (`cropToCanvas().then` with no `.catch`).
  - **What happens:** a HEIC or PDF gives a blank crop screen and Apply does nothing. A canvas failure is an unhandled rejection with no message.
- **C02-A47 A LinkedIn photo is lost if the tab changes while the popup is open.** Low. Confirmed.
  - **Where:** ProfilePhotoSuggest.tsx:217-273, 251-252. It is mounted only on the Card design tab (CEF:1198).
  - **What happens:** unmounting loses `pendingNonce`, so the consented photo is never applied.
- **C02-A48 The LinkedIn connect fallback leaves the editor with unsaved edits.** Low. Confirmed.
  - **Where:** ProfilePhotoSuggest.tsx:81 and the `<a href>` at :430, :501, :513.
  - **What happens:** when the popup is blocked, or the link is tapped before hydration, the page navigates away with `location.href`. Edits survive only if the user cancels the `beforeunload` prompt.
- **C02-A58 "Continue with Free" leaves the design converted when the POST fails.** Low. Confirmed.
  - **Where:** W:731-740.
  - **What happens:** state is converted before the POST and not restored on failure; Undo still works. The Pro dialog's "Save without them" behaves the same way.

### Plan gating and server validation

- **C02-A19 ✔ The per-link "Row style" (Solid / Outline) Pro control works on Free.** Medium. Confirmed.
  - **Where:** written at LinkButtonsControls.tsx:266-273. `proLinkFeaturesInUse` (plan.ts:419-470) never checks `rowStyle`. The public render (SwiftLinkButtons.tsx:340-361) applies `resolveRowStyle` with no paid check; only glass is gated.
  - **What happens:** Free pages show Solid and Outline rows, so the PRO tag (SwiftLinkDesign.tsx:1024) is wrong.
- **C02-A21 On Free, the Edit card preview ignores Pro Swift Links controls.** Medium (UX). Confirmed.
  - **Where:** CEF:807 passes `paid={isPro}` to SwiftLinkLivePreview (:80-102), which drops the Pro look, colours, font, icons and tiles.
  - **What happens:** the controls are deliberately live for previewing, but on Free tapping them changes nothing visible until Save shows the Pro dialog. The wizard uses `designUnlocked` and is fine.
- **C02-A28 Pro media uploads are not plan-gated on the server.** Low. Confirmed.
  - **Where:** `POST /api/upload` (:98) accepts `cardbg`, `hero`, `pagebg` and `link` from any signed-in Free account; `/api/upload/link-video` has no plan check.
  - **Impact:** storage cost only, because the render strips the media.
  - **Related:** the guest half, and the declared-size issue, are C02-013. The bucket has a 26 MB cap and a MIME allow-list (`supabase/security-lockdown-2026-09-24.sql:36-37`).
- **C02-A43 ✔ View-only cards look editable, and their URL can be renamed.** Medium. Confirmed.
  - **Where:** `page.tsx` never computes view-only status; `POST /api/cards/[id]/rename` (`rename/route.ts:17-91`) has no `freeLiveCardIds` or plan check, unlike PATCH (:98-108).
  - **What happens:** the editor renders fully and the user only learns the card is locked at Save (403). A Free user can still change the public URL of an offline, view-only card.
- **C02-A49 Several card fields have no length limit on the client or the server.** Low. Confirmed.
  - **Where:** `clampCardWrite` (card-limits.ts:60-86) skips them, and the inputs have no `maxLength`.
  - **Fields:** `label` / nickname (CEF:1081, W:1866), `customization.bio` (CEF:1279, W:1925), the 7 social handles, and link labels and URLs (AddLinkForm). Applies to both POST and PATCH.
- **C02-A51 Malformed JSON returns 500, and a PATCH to someone else's card returns ok.** Low. Confirmed.
  - **Where:** `await req.json()` is unguarded in `api/cards/[id]/route.ts:28`, `admin/create-card` and `office/cards/[id]`.
  - **What happens:** malformed JSON gives a 500. A paid user's PATCH to a card id they don't own returns `200 {ok:true, slug:null}` (:313-317, 434). This is a silent no-op, not a data leak.
- **C02-A55 The card-count limit is not atomic.** Medium. Confirmed (race).
  - **Where:** `cards/route.ts` counts at :30-58 and inserts at :207.
  - **What happens:** two tabs or devices creating at once can leave a Free account, or an Office member, with 2 cards. `creatingRef` (W:1197) only guards one tab.
  - **Related:** distinct from the claim race in C02-008.
- **C02-A59 The Office member "mobile-only phone" rule is client-only.** Low. Confirmed.
  - **Where:** W:827 forces the label; `overlayOfficeContact` (office-brand.ts:460-475) only strips entries marked `office:true`.
  - **What happens:** a crafted request can save a member phone labelled "office".
- **C02-A60 Bio and nickname are required only in the UI.** Low. Confirmed.
  - **Where:** W:551, 566 and CEF:585, 601.
  - **What happens:** `POST /api/cards` validates only the name (route:76-81).
- **C02-A36 The AI and Copy routes check the raw `plan` column, not the effective plan.** Low. Confirmed.
  - **Where:** design-transfer:85-91, scan-design:39-46, design-generate:62-67.
  - **What happens:** they use `isPaidPlan(profiles.plan)` instead of `isPaidProfile` / `PLAN_COLUMNS`, so an expired timed grant keeps AI access until the daily expiry job runs.

### Links editor behaviour

- **C02-A23 `mailto:` and `tel:` links become dead https links.** Medium. Confirmed.
  - **Where:** `addLink` (CEF:457, W:845) only recognises `http(s)://`.
  - **What happens:** `tel:+1555…` is saved as `https://tel:+1555…`, even though the renderer supports `mailto` and `tel` (SwiftLinkButtons.tsx:86).
- **C02-A24 "Web address" accepts anything, with no feedback.** Low. Confirmed.
  - **Where:** AddLinkForm.tsx:117 + `addLink`.
  - **What happens:** "my site" becomes `https://my site`. Empty input returns silently (W:844). The server does not validate `links[].url` either.
  - **Mitigation:** rendering is safe, because `fullHref` (SwiftLinkButtons.tsx:83) neutralises `javascript:` and `data:`.
- **C02-A25 The Free link cap counts section headers inconsistently.** Low. Confirmed.
  - **Where:** the client (`atLinkCap`, CEF:451, W:839) and the POST sanitize count header rows toward the cap of 2; the public page excludes headers (`links/[username]/page.tsx:250`).
  - **What happens:** a header uses up a slot, and on a Free create it can push a real link out.
- **C02-A26 Links cannot be edited or reordered.** Medium (UX). Confirmed.
  - **Where:** every editor.
  - **What happens:** there is no edit-in-place for a link's URL or label, and no reorder by drag, arrows or keyboard. Changing order means removing and re-adding the link, which loses its size, media and blur.
- **C02-A65 Tapping the already-selected "Grid" size triggers the Pro dialog on Free.** Low. Confirmed.
  - **Where:** LinkButtonsControls.tsx:197.
  - **What happens:** the tap writes `size:"grid"` explicitly, so Save shows the Pro dialog for a choice the user didn't change.

### Navigation and flow

- **C02-A39 Client-side links bypass the unsaved-changes guard.** High. Confirmed.
  - **Where:** `page.tsx:142, 149, 172`, CEF:1401, CEF:1511, CustomDesignCard.tsx:59, and the Pro dialog's CTA (`ProOffer.tsx:156`). These are Next `<Link>` navigations, which `beforeunload` does not catch.
  - **What happens:** unsaved edits are dropped with no prompt.
  - **Worst case:** a Free user designs a Pro card, presses Save, taps "Start my free trial", and loses the design they were paying for.
- **C02-A52 ✔ A name with no Latin letters cannot get past wizard step 1.** High (international users). Confirmed.
  - **Where:** W:868-871 and W:1186-1189; `fuseWords` splits on `[^a-zA-Z0-9]` (slug.ts:61).
  - **What happens:** a name such as 李明 with no company gives an empty `username`, so the user sees "Please enter a name we can turn into a URL." with no field highlighted.
  - **Dead end:** an Office member whose office has no company has no company field to fill in, so they cannot continue at all.
  - **Note:** the server has fallbacks (route:88-91), but the client never sends the request.
- **C02-A53 The wizard's link cap ignores Pro intent, and its upgrade link leaves the builder.** Medium. Confirmed.
  - **Where:** W:839 uses `!isPro`, while design access uses `designUnlocked` (W:322). The "Upgrade to Pro" link is at W:2027.
  - **What happens:** a guest who arrived from `/pricing?plan=pro` is still held to 2 links. "Upgrade to Pro" sends a guest to `/login?next=/upgrade`, out of the builder and without `claim=1`, so the draft is not claimed.
- **C02-A54 "Get Office" from a Free account that already has a card ends on the upgrade page.** Medium. Confirmed.
  - **Where:** P:65 fast-paths only `plan=pro`, and P:110 exempts `authedPlan` from the cap redirect. The route's cap check (:47) returns 402 before it looks at `chosenPlan`, and W:1268-1286 then redirects to `/upgrade?from=card-limit`.
  - **What happens:** the user builds a whole card, then lands on the upgrade page with plan, seats and promo dropped.
- **C02-A62 The wizard's step 2 and step 4 upgrade links are effectively unreachable.** Low. Suspected (orphan controls).
  - **Where:** PlanGate links at W:2276-2285 and W:2361-2370.
  - **Why:** they need "not Pro and not designUnlocked", and P:110-126 routes every Free account in that state elsewhere.

### Admin console

- **C02-A09 The admin plan select ignores failures.** Medium. Confirmed.
  - **Where:** UsersClient.tsx:72-81.
  - **What happens:** `setPlan` never checks `res.ok` and has no catch. A 409 or 400 from set-plan is discarded with no message. If the fetch throws, the select stays disabled for good.
- **C02-A10 A failed user list load looks like an empty list.** Low. Confirmed.
  - **Where:** UsersClient.tsx:115-123.
  - **What happens:** a failed load shows "No users found"; a thrown fetch leaves "Loading…" forever.
- **C02-A11 Create card always says the email was sent.** Medium. Confirmed.
  - **Where:** UsersClient.tsx:162-163 and :316, vs `create-card/route.ts:164-172`.
  - **What happens:** the route returns `loginEmailed` and `setupLink`, but the UI ignores both and always says "A password reset email was sent". When the email fails, the admin never sees the setup link and the new owner cannot log in.
- **C02-A12 Admin-created usernames have no length cap.** Low. Confirmed.
  - **Where:** `create-card/route.ts:34`.
  - **What happens:** EmailSignatureBox (:218) and `/api/card-signature` reject slugs longer than 40 characters, so a long admin-made slug can never produce a Swift Signature. It fails silently as "Couldn't copy". Slugs created elsewhere are capped (lib/username.ts:54).
- **C02-A13 Admin Create card validates only some of its fields.** Low. Confirmed (Office impact Suspected).
  - **Where:** `create-card/route.ts:17` and :85.
  - **What happens:**
    - `accentColor` is stored unvalidated, although the other colours are hex-checked.
    - name, company, title and phone have no type or length check.
    - `plan:"enterprise"` creates an Office profile with no `offices` row.
  - **Also:** the comment at :49-55 describes a "follow-on card insert" that no longer exists.

### Share, signature, wallet and download

- **C02-A14 Wallet errors show a raw JSON page.** Low. Confirmed (header part Suspected).
  - **Where:** AddToWalletButton.tsx:113; `api/wallet/pass/route.ts:12-20, 54, 84`.
  - **What happens:** a 501, 404, 429 or 500 lands the user on a raw JSON page with no in-app error.
  - **Also:** the `Content-Disposition` filename uses the raw `card` query value.
- **C02-A15 "Download QR (PNG)" fails silently.** Low. Confirmed.
  - **Where:** QRDownloadButton.tsx:43-47.
  - **What happens:** there is no loading state and no double-tap guard, and `catch {}` swallows errors. Repeated taps can open several save sheets.
- **C02-A16 The signature's last clipboard fallback pastes raw HTML.** Medium. Confirmed.
  - **Where:** EmailSignatureBox.tsx:473-475.
  - **What happens:** `writeText(buildSignatureHtml())` copies markup as plain text, yet the UI says "Copied ✓ Now paste it in your email". The user pastes literal `<table><img>` tags into their mail signature.
- **C02-A18 Suggested logos are stored as third-party hotlinks.** Medium. Suspected.
  - **Where:** `LogoSuggest.choose` → `cards.logo_url` (CEF:1153) or `offices.brand_logo_url` (OfficeBranding:277, route:177/248). Sources are in `logo-suggest/route.ts:61-68`.
  - **What happens:** the logo is never re-hosted. If the provider changes the URL, every card, or a whole team, loses its logo. "Adjust" (ImageUpload:170, a CORS fetch) and card capture may fail on hosts without CORS.
- **Already covered:** the card-signature route's missing PNG check is part of C02-002 and is not given a new number.

### Designer

- **C02-A30 The free-form designer has no keyboard path.** Medium (accessibility). Confirmed.
  - **Where:** FreeCardEditor.tsx:157-177, 210-224, 353-365.
  - **What happens:** selection needs a pointer, and `onKeyDown` returns at once when nothing is selected (:211). The resize handle is a `<span>` inside an `aria-hidden` box, so it cannot be focused.
- **C02-A32 "Add to card" ignores the 40-element cap and can silently delete an element.** Medium. Confirmed.
  - **Where:** FreeCardEditor.tsx:282-290, 565-567 vs custom-layout.ts:982 (`slice(0, MAX_FREE_ELEMENTS=40)`).
  - **What happens:** at 40 elements, adding a shape puts it first, and the normalizer then cuts the top-most element (often the name or the QR code) from the published card with no message. Adding anything else appends an element that is cut at once, so the button looks dead.
- **C02-A33 Opacity slider changes may never be saved.** Low. Suspected.
  - **Where:** FreeCardEditor.tsx:487-489, :121, :206.
  - **What happens:** the value is committed only on pointer-up or key-up, so changes made with assistive technology never commit. While the uncommitted value is held, it also masks later panel edits.
- **C02-A35 "Copy a card" errors are misleading and not announced.** Low. Confirmed.
  - **Where:** CustomCardDesigner.tsx:205-213 vs `design-transfer/route.ts:139` and :120. The error paragraph is at :555.
  - **What happens:** both the 400 `no_name` (empty card name) and the 413 (image too large) show "try a cleaner image", which cannot fix either. The error paragraph has no `role="alert"`.
- **C02-A37 Typing in the designer's Text box can wipe undo history.** Low. Confirmed.
  - **Where:** CustomCardDesigner.tsx:114-120 + FreeCardEditor.tsx:448.
  - **What happens:** where there is no tab history (Office Branding, homepage builders), each keystroke is one entry on a 50-entry stack, so typing pushes out earlier design steps.
- **C02-A38 AI Generate and Copy guard against double taps with React state only.** Low. Suspected.
  - **Where:** CustomCardDesigner.tsx:176-179, 300-303; AiDesignSheet.tsx:178.
  - **What happens:** two taps in one frame can start two paid model calls. Rate limits cap the damage.
- **C02-A27 Uploads by signed-in users are never cleaned up.** Low. Confirmed.
  - **Where:** "Replace", "Remove", "Use link preview", "Start over", Discard of a deferred upload, design-transfer "Try again" / "Cancel" (route:255-266), and a failed video poster (TSC:434-443).
  - **What happens:** the old objects are never deleted. This is the signed-in counterpart of C02-013.

### Accessibility and modals

- **C02-A34 Three overlays are not real modals.** Medium. Confirmed.
  - **Where:**
    - CustomCardDesigner copy-approval dialog (:580-647)
    - Wizard plan-gate overlay (W:2471-2541)
    - Admin Create-card modal (UsersClient.tsx:297-302), whose ✕ also has no label
  - **What happens:** none of them handles Escape, or moves, traps and restores focus. The last two also lack `role=dialog`. The shared `useDialogA11y` hook is used elsewhere but not here.
- **C02-A31 Colour and font controls have wrong or missing accessible names.** Low. Confirmed.
  - **Where:**
    - Every TSC preset swatch (TemplateStyleControls.tsx:200), the SwiftLinkDesign presets (:132) and the admin modal presets are all labelled "Color preset".
    - Every SwiftLinkDesign custom colour input says "Accent colour" (:140).
    - FreeCardEditor and AiDesignSheet swatches are named by raw hex.
    - The FreeCardEditor "Text" input has no name (:443-450).
    - Font, Align, Frame, header-style and icon buttons have no `aria-pressed`.
- **C02-A57 Error messages are not announced.** Low. Confirmed.
  - **Where:** W:2372 (create error), CustomCardDesigner :555 (copy error), OfficeLinksBranding.tsx:387-388 (status). None has `role="alert"` or a live region.
- **C02-A61 Address and label problems.** Low. Confirmed.
  - **Where:**
    - AddressInput State has `maxLength=2` (AddressInput.tsx:70-74), which blocks "NSW" and "Ontario".
    - The address inputs have placeholders only, no labels.
    - OfficeBranding `<label>`s have no `htmlFor` / `id` (:296-317).

### Error exposure and miscellaneous

- **C02-A56 ✔ Raw database errors are shown to users.** Low. Confirmed.
  - **Where:** `cards/route.ts:225-226` returns `error.message` with a 500, and W:1291 displays it.
- **C02-A50 `POST /api/integrations/linkedin` has no rate limit.** Low. Confirmed.
  - **Where:** `linkedin/route.ts:63-111`.
  - **What happens:** each call fetches from LinkedIn and writes to card-uploads; the sibling photo-suggest and upload routes are throttled.
- **C02-A63 Code comments contradict the code.** Comment-only. Confirmed.
  - **Where:**
    - W:2344 and `uploadErrorMessage` say guests get a 401; the upload routes accept guests.
    - LinkButtonsControls.tsx:14-17 says "Free sees the picker disabled"; every control is live.
    - The TSC `canUpload` doc (:548-551) doesn't match how it is mounted.
    - The create-card comment at :49-55 describes an insert that no longer exists.
- **C02-A64 Minor issues.** Low. Confirmed except where marked.
  - The admin users table's `<tr onClick>` has no keyboard path (UsersClient.tsx:254).
  - The FreeDesignChoice buttons have no `type="button"` (:86, :127). This is latent: no `<form>` contains them today.
  - TSC hard-codes `id="panel-dim"` (:491).
  - CardPreviewDownload no longer downloads anything.
  - The CEF `isPrimary` / `/api/profile` path is dead code.
  - The clickable preview `div`s in PinnedCardPreview have no role.
  - (Suspected edge case) The wizard decides "signed in" from a cookie regex (guest-draft.ts:214-221) when choosing which draft to carry through the claim.

### Checked and refuted (do not file)

- **"`/api/design-transfer` and `/api/scan-design` have no AI-consent check."** This is false: both call `aiConsentBlock` (design-transfer:81, scan-design:35).
- **"`/api/card-signature` has no PNG magic-byte check."** This is true, but it is already part of C02-002.

### Design notes (deliberate, not defects)

- `PATCH /api/cards/[id]` stores Pro customization keys and links over the Free cap as sent, and enforces the plan at render (route comment :143-168).
- `POST /api/cards` skips sanitizing when `chosenPlan` is pro or office (:69-70); the public render re-sanitizes.
- For an API-only client, this makes the Free/Pro gate UI-only on write. The audit owner should decide whether at least a size cap belongs on write (see C02-A49).
