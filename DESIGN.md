---
name: QARoom
description: A cool, literate community platform that reads like a well-set technical journal.
colors:
  bg: "oklch(0.980 0.003 258)"
  surface: "oklch(0.996 0.002 258)"
  sunk: "oklch(0.958 0.004 258)"
  ink: "oklch(0.255 0.012 262)"
  muted: "oklch(0.498 0.014 260)"
  line: "oklch(0.888 0.006 258)"
  slate: "oklch(0.470 0.078 262)"
  slate-fg: "oklch(0.996 0.002 258)"
  violet: "oklch(0.495 0.090 300)"
  sage: "oklch(0.450 0.085 150)"
  amber: "oklch(0.475 0.085 80)"
  red: "oklch(0.490 0.135 25)"
typography:
  display:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2rem, 1.4rem + 2.4vw, 3.25rem)"
    fontWeight: 460
    lineHeight: 1.05
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.6rem"
    fontWeight: 500
    lineHeight: 1.15
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.2rem"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  sm: "3px"
  md: "5px"
  lg: "8px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "28px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.slate-fg}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    height: "44px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
    height: "44px"
  chip:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
---

# Design System: QARoom

## 1. Overview

**Creative North Star: "The Slate Commons"**

QARoom reads like a well-set technical journal that happens to be social software. The surface is a cool, near-neutral grey, not a warm page and not a dark control panel. Structure comes from typographic hierarchy, generous whitespace, hairline rules, and crisp (barely-rounded) edges, not from a grid of identical cards. A single muted slate accent carries interaction; everything else is calm, literate, and unhurried. A member should feel they are reading and writing in a considered, quiet space; an operator should feel they are tending something, not operating a dashboard of dials.

This system explicitly rejects four things. It is **not a generic SaaS dashboard** (no left sidebar plus uniform card grid). It is **not developer-tool dark-blue** (the accent is a *muted* slate, never an electric blue, and grey is the resting state). It is **not corporate enterprise** (no navy, no gradients, no hero-metric blocks). It is **not a consumer-social clone** (it borrows the shape of feeds and votes, never the visual cliché). It is also deliberately **not warm or earthy**: neutrals are cool greys, never clay, sand, or beige.

Default theme is **cool light grey**; a **cool graphite** counterpart flips the same tokens for night. Dark is the alternate, never the default.

**Key Characteristics:**
- Cool grey field, one muted slate accent, cool near-black ink. No pure black/white, and no warm/earthy tint anywhere.
- Editorial type: a variable serif for anything titular, a humanist sans for prose and UI, tabular numerals for scores.
- Hairlines and whitespace divide content. Cards are the rare exception; nested cards forbidden.
- Crisp corners (3–8px) — softened just enough to not be brutalist, never pill-soft.
- Flat by default; shadow only floats true overlays. Restrained motion.

## 2. Colors

A cool, low-chroma grey palette anchored by a single muted slate accent; every neutral is tinted toward hue ~258 (cool), never toward warmth.

### Primary
- **Slate** (`oklch(0.470 0.078 262)`): the one committed accent. Primary actions, the upvote arrow and active score, the active nav marker, focus rings. Muted on purpose — low enough chroma to read as a cool grey-blue, never an electric dev-blue. Used with intent, not everywhere.

### Secondary
- **Violet** (`oklch(0.495 0.090 300)`): a cool tertiary used only as one of the avatar tints, for identity variety. Never a UI accent.

### Tertiary
- **Sage** (`oklch(0.450 0.085 150)`): success and "enabled" states (a flag reaching Enabled, a delivered webhook). A cool green.
- **Amber** (`oklch(0.475 0.085 80)`): warning and in-progress states (canary, retrying). Desaturated so it never reads as earthy.
- **Red** (`oklch(0.490 0.135 25)`): danger, removal, dead-letter, and the downvote direction.

### Neutral
- **Ink** (`oklch(0.255 0.012 262)`): primary text. A cool near-black, never `#000`.
- **Muted** (`oklch(0.498 0.014 260)`): secondary text, metadata, timestamps. Holds AA on bg and surface.
- **Bg** (`oklch(0.980 0.003 258)`): the page field, the dominant surface.
- **Surface** (`oklch(0.996 0.002 258)`): raised reading surfaces and inputs, one tonal step above bg.
- **Sunk** (`oklch(0.958 0.004 258)`): recessed wells (quiet chips, hover, avatars).
- **Line** (`oklch(0.888 0.006 258)`): hairline dividers and borders. The primary structural tool.

### Named Rules
**The Cool-Neutral Rule.** Every neutral carries chroma ≤0.014 toward hue ~258. A warm or earthy neutral (clay, sand, beige, hue ~70) is forbidden; it betrays the journal voice.
**The One Accent Rule.** Slate appears on roughly 10–15% of any screen: one primary action, the vote affordance, the active marker. Its scarcity is what keeps the surface calm.
**The Muted-Not-Electric Rule.** The accent's chroma stays ≤0.08. A saturated blue is banned — slate must read as cool grey-blue, never as a dev-tool accent. No other blue exists in the system.

## 3. Typography

**Display Font:** Fraunces (with Georgia, then Times New Roman, serif)
**Body Font:** Hanken Grotesk (with system-ui sans fallback)
**Numerals:** the body and display families set with `font-variant-numeric: tabular-nums` for all scores, counts, and ledgers. No mono font; a terminal mono would betray the cool-editorial voice.

**Character:** Fraunces is a soft, optical-sized variable serif with a literary edge; it does all titular work and gives the product its journal voice. Hanken Grotesk is a humanist sans, friendlier than the SaaS-default Inter, carrying prose, labels, and UI. The pairing is "considered editorial," not "tech startup."

### Hierarchy
- **Display** (Fraunces 460, `clamp(2rem, 1.4rem + 2.4vw, 3.25rem)`, 1.05): page mastheads and the rare hero title. One per view, maximum.
- **Headline** (Fraunces 500, 1.6rem, 1.15): section titles, a post's title on its detail page.
- **Title** (Fraunces 500, 1.2rem, 1.25): post titles in the feed, panel headings.
- **Body** (Hanken Grotesk 400, 1rem, 1.6): prose and post bodies, capped at 68ch.
- **Label** (Hanken Grotesk 600, 0.75rem, +0.06em, uppercase): metadata eyebrows, section kickers, the only uppercase in the system.

### Named Rules
**The Serif-For-Names Rule.** Anything that names a thing (a post, a community, a section) is set in Fraunces. Anything that explains or operates is Hanken Grotesk.
**The Tabular Rule.** Every number that can change (scores, counts, amounts, attempts) is `tabular-nums` so it never jitters as it updates.

## 4. Elevation

Flat by default. Depth is conveyed by cool tonal layering (bg → surface → sunk) and hairline rules, not by shadow. Things sit on the grey field; they do not hover. Shadow is reserved exclusively for elements that genuinely float: menus, popovers, dialogs.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 28px -8px oklch(0.20 0.02 262 / 0.25)`): the single cool-tinted shadow, used only on true overlays. The tint matches ink, never warm.

### Named Rules
**The Flat Rule.** Resting surfaces cast no shadow. Separation is a hairline or a tonal step, never a drop shadow. A shadow on a static card is the 2014-dashboard tell; remove it.

## 5. Components

### Buttons
- **Shape:** crisp (5px radius), never pill except icon toggles. Minimum 44px tall.
- **Primary:** slate fill, surface-light text, generous padding (12px 20px). One accent action per region.
- **Ghost:** surface background, ink text, hairline (1px line) border. Default for secondary actions.
- **Danger:** red fill, light text. Destructive only.
- **Hover / Focus:** hover lifts lightness ~4% (no layout-property animation); focus shows a 2px slate focus-visible ring at 2px offset. Transitions ease-out, 140ms, disabled under reduced motion.

### Chips / Badges
- **Style:** rounded-full, low-chroma tint background (sunk for neutral; slate/sage/amber/red tints at ~10–15%), colored text in the matching hue. Text holds AA on the tint.
- **State:** status badges (flag state, donation status, delivery status, role) map to the semantic hues; selected filter chips use a slate tint with slate text.

### Cards / Containers
- **Default to none.** Most groupings are whitespace plus a hairline, not a card. Reach for a card only when a single thing must be lifted (a focused form, the sign-in panel).
- **When used:** 8px radius, surface background, 1px line border, no shadow at rest, 20–28px internal padding.
- **Nested cards are forbidden.**

### Inputs / Fields
- **Style:** surface background, 1px line border, 5px radius, 44px tall, ink text, muted placeholder.
- **Focus:** border shifts to slate and a 2px slate ring appears (no glow).
- **Error:** border and helper text in red; the field keeps its shape, the message sits below in label size.

### Navigation
- **Masthead, not sidebar.** A slim top masthead carries the Fraunces wordmark, a community switcher, and the account menu. No persistent left rail.
- **Section nav** is a row of text links (ink, muted when inactive) with a 2px slate underline on the active link; not boxed tabs.
- **Mobile:** the masthead's dropdowns carry navigation; no separate drawer is needed.

### Post Row (Signature Component)
The feed is not a card grid. Each post is a **row**: a left vote cluster (slate/red arrows around a tabular-nums score, borderless until active), a Fraunces title link, and a single muted meta line (author · time). Rows are hairline-separated, full-bleed to the reading column.

## 6. Do's and Don'ts

### Do:
- **Do** keep the surface a cool grey; tint every neutral toward hue ~258 (chroma ≤0.014).
- **Do** structure with hairlines (`line`) and whitespace; let the reading column breathe at 68ch.
- **Do** set every name (post, community, section) in Fraunces and every score in `tabular-nums`.
- **Do** spend slate sparingly: one primary action, the vote, the active marker (~10–15%).
- **Do** keep corners crisp (3–8px) and every interactive target ≥44×44px with a 2px slate focus ring.
- **Do** keep surfaces flat at rest; reserve the single cool Float shadow for overlays only.

### Don't:
- **Don't** use **warm or earthy** neutrals (clay, sand, beige, hue ~70). Neutrals are cool grey.
- **Don't** build a **generic SaaS dashboard**: no persistent left sidebar plus uniform card grid.
- **Don't** use **developer-tool dark-blue** or any saturated/electric blue; the slate accent stays muted (chroma ≤0.08).
- **Don't** go **corporate enterprise**: no navy, no gradients, no `background-clip: text`, no hero-metric blocks.
- **Don't** ship a **consumer-social clone**: borrow the feed/vote shape, never the skin.
- **Don't** nest cards, or reach for a card when a hairline and whitespace will do.
- **Don't** put a shadow on a resting surface, use a mono font for numerals, or use `#000`/`#fff`.
- **Don't** use pill-soft radii on panels/cards; keep edges crisp.
