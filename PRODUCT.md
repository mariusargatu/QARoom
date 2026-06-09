# Product

## Register

product

## Users

Two audiences operate the QARoom web app:

- **Community members** — people who read, post, vote, and donate inside a community. Context: browsing a feed, writing a post, catching up on activity. They want to participate and feel at home, not operate machinery.
- **Community operators** (owners / moderators) — people who configure and tend a community: manage members and roles, control feature rollouts, register webhooks, and review the moderation agent's decisions. Context: occasional, deliberate, often on a larger screen. They want calm, legible control, not a wall of dials.

QARoom also doubles as a *built-in-public demonstration* of testing-driven architecture. The surface being designed is the product itself; the demonstration value rides on the product feeling genuinely crafted, not on showing seams.

## Product Purpose

QARoom is a multi-tenant community platform: communities-as-tenants, posts with up/down votes, donations, feature-flag rollouts, outbound webhooks, and an LLM moderation agent. The web app is where members participate and operators tend their communities. Success is a surface that makes *participation feel human and warm* and *operation feel calm and literate* — while staying honest about state (loading, empty, error, partial) because honesty about state is the architecture's whole thesis.

## Brand Personality

Editorial, spare, literate — with warmth. Voice is quiet and confident: it sets type well, leaves room to breathe, and uses one committed warm color to feel human rather than corporate. It reads like a well-made independent publication that happens to be social software. It never shouts, never decorates for decoration's sake, and never hides what it's doing.

## Anti-references

Explicitly NOT, in order of importance:

- **Generic SaaS dashboard** — left sidebar + uniform card grid + gray-on-gray. This is the current build's reflex and the thing we are deliberately leaving behind. Structure with type, whitespace, and hairlines, not cards.
- **GitHub / developer-tool dark-blue** — the `#0b0e14` + electric-blue palette. The category-typical "dev tool" look; we go warm instead.
- **Corporate enterprise** — navy, gradients, stock polish, hero-metric blocks. Soulless B2B.
- **Consumer-social clone** — a Reddit/Twitter reskin. We borrow the *shape* (communities, feeds, votes) but never the visual cliché.

## Design Principles

1. **Warm, not loud.** Human warmth comes from one committed color and soft forms, not from saturation everywhere or novelty. Restraint is the source of the warmth, not its opposite.
2. **Editorial restraint.** Hierarchy is carried by type scale, weight, and whitespace, with hairline rules where separation is needed. Cards are the exception, never the default; nested cards never.
3. **Borrow the shape, not the skin.** Take the mechanics of community software (feeds, votes, communities, activity) and dress them in a voice that is unmistakably ours, never a clone.
4. **Practice what you preach.** The app embodies the testing-architecture ethos: every screen has honest loading / empty / error states, is keyboard- and screen-reader-accessible, and never fakes data it doesn't have.
5. **Calm operation.** Operator surfaces (flags, members, webhooks, moderation) are literate and unhurried — explained, legible, reversible — not a control panel of switches.

## Accessibility & Inclusion

- **WCAG 2.1 AA**, enforced in CI: every Storybook story passes axe (the a11y gate fails the build on a violation). Both light and dark themes meet AA contrast on every semantic token.
- **Reduced motion** is honored (`prefers-reduced-motion`): all transitions degrade to none.
- **Keyboard + screen reader** are first-class: visible focus rings, correct roles/labels, semantic landmarks and heading order.
- **Touch** targets are at least 44×44px (a known gap in the current build to correct in the redesign).
- Operator data density must never trade away legibility; warmth must never trade away contrast.
