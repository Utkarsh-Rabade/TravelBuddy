# TravelBuddy — Antigravity UI Redesign Handoff

## Purpose

This document gives Antigravity the minimum context required to redesign ONLY the public TravelBuddy landing page without wasting time understanding the entire application.

The task is a frontend/visual redesign only. The core architecture, Clerk authentication, Supabase database, migrations, RLS, and Phase 1 application flows already exist.

## Product

**TravelBuddy** connects elderly travelers with verified companions for safer and more comfortable journeys.

Primary positioning:
> Safe journeys. Trusted companions.

Core qualities: trust, safety, human connection, travel, premium service, confidence.

Two primary user groups:
- Families / travelers: create traveler profiles, request assistance, find companions, follow trip progress.
- Companions: create profiles, define availability, complete verification, receive relevant trip matches.

## Current technical state

Existing stack includes:
- Next.js + TypeScript
- Clerk authentication
- Supabase database
- Supabase RLS
- Existing migrations
- Existing dashboard/auth routes
- Existing matching functionality

The database architecture has already been redesigned around Clerk as the identity provider, Clerk IDs stored as TEXT where needed, UUID internal primary keys, Clerk-JWT-based RLS, sensitive data protection, and trip/booking/matching/SOS/location/messaging/notification/rating/audit concepts.

The remote development database has already received the canonical migrations successfully.

### DO NOT change during this landing-page task
- Supabase
- database schema
- migrations
- RLS
- Clerk configuration
- authentication logic
- server actions
- API routes
- matching logic
- dashboard functionality

## Authentication routes

Clerk is already working.

Existing routes:
- `/auth/sign-in`
- `/auth/sign-up`

Use these existing routes; do not replace Clerk.

Recommended CTA behavior:
- Get started -> `/auth/sign-up`
- Sign in -> `/auth/sign-in`
- Become a companion -> existing signup/auth flow unless a dedicated companion onboarding route already exists

## Current landing-page problem

The current page is technically functional but visually poor. It currently suffers from:
- weak hero composition
- missing/poor Earth hero visual
- oversized full-width CTA bars
- weak navbar alignment
- sections that read like documentation
- excessive empty black space
- poor visual hierarchy
- insufficient use of cards/imagery
- horizontal overflow/clipping

This needs a proper visual redesign, not small spacing patches.

# DESIGN TARGET

Create a premium cinematic travel-tech landing page inspired by the supplied reference design.

Visual language:
- deep black / near-black background
- liquid-chrome / silver typography
- restrained blue/cyan lighting
- subtle magenta/pink accents
- glass surfaces
- cinematic depth
- polished spacing
- premium typography
- soft glow
- subtle motion

TravelBuddy should feel like a premium travel startup + futuristic technology + trust/safety.

It must NOT feel like a generic SaaS template, AI dashboard, crypto site, gaming site, documentation page, or plain Tailwind template.

# HERO — MOST IMPORTANT

Build a true desktop two-column hero.

## Left

Eyebrow:
`● VERIFIED COMPANIONS`

Headline:
`Safe journeys.`
`Trusted companions.`

Use large cinematic chrome/silver typography.

Supporting copy:
`TravelBuddy connects elderly travelers with verified companions who help make every journey safer, simpler and more comfortable.`

Two compact CTA buttons side by side:
- `Find a TravelBuddy →`
- `Explore how it works`

Primary button:
- pink -> purple -> blue
- rounded
- glossy
- subtle glow

Secondary button:
- dark translucent glass
- thin border
- compact

Under buttons:
`Verified companions • Safety-first matching • Built for peace of mind`

## Right — EARTH

The right side MUST contain a large realistic Earth viewed from space.

This is the hero's main visual anchor.

It should have:
- realistic continents
- realistic clouds
- blue atmosphere
- cyan edge light
- subtle magenta reflected light
- dark space
- cinematic lighting
- soft glow
- subtle stars/particles

Do NOT use a flat CSS circle, tiny globe icon, teal rectangle, polygon, or placeholder.

Prefer a high-quality local visual asset so it is reliable.

# BACKGROUND

Use a near-black space background with layered atmospheric lighting:
- blue glow around/behind Earth
- cyan highlights
- subtle magenta glow
- tiny stars/particles
- optional subtle grain/noise

Avoid a giant obvious purple gradient.

# NAVIGATION

Desktop:

Left:
`TravelBuddy.`

Center:
- How it works
- For Families
- For Companions
- Safety

Right:
- Sign in
- Get started

Use a subtle translucent/glass navigation treatment.

Must remain inside the viewport. No clipping. No horizontal overflow.

Mobile:
- compact brand
- menu button
- primary CTA remains visible

# TRUST STRIP

Do NOT use fake customer/company logos.

Use:
- VERIFIED COMPANIONS
- SECURE BOOKINGS
- SAFETY-FIRST MATCHING
- TRIP CHECK-INS

Use subtle separators/icons.

# HOW IT WORKS

Create three premium visual cards:

### 01 — Create a trip
Families add traveler information, destination, dates and assistance needs.

### 02 — Meet the right companion
Matching considers route, language, assistance needs and availability.

### 03 — Travel with confidence
Trip updates, check-ins and safety functionality keep everyone connected.

Cards should have:
- dark glass surface
- subtle border
- rounded corners
- internal highlight
- large number
- icon
- concise copy
- hover movement

Desktop: three-column grid. Mobile: stacked.

# FAMILIES & TRAVELERS

Use a visually rich split section.

Eyebrow:
`FAMILIES & TRAVELERS`

Heading:
`Peace of mind for every journey.`

Use a strong travel/family visual on one side and concise features on the other:
- Create traveler profiles
- Request assistance
- Find verified companions
- Track trip progress

Do not create a giant paragraph-heavy block.

# COMPANIONS

Use a reversed split visual section.

Heading:
`Turn your travel experience into meaningful support.`

Features:
- Build a companion profile
- Set availability
- Complete verification
- Receive relevant matches

CTA:
`Become a companion →`

# SAFETY

Heading:
`Because safety should travel with you.`

Use six polished visual cards:
1. Verified companions
2. KYC verification
3. Emergency contacts
4. Trip check-ins
5. Location updates
6. SOS support

This section should feel reassuring, not alarming. Use subtle cyan/blue safety lighting.

# MATCHING ENGINE

Heading:
`Not just a match.`
`The right match.`

Make this look like a product visualization:

`Traveler requirements`
`↓`
`Matching engine`
`↓`
`Ranked companions`

Visual factors:
- Route
- Language
- Assistance
- Availability
- Verification
- Experience

Use pills, progress indicators, connecting lines, mini cards, or similar UI.

Do NOT present this as a plain list of paragraphs.

# FINAL CTA

Cinematic closing section.

Heading:
`Every journey deserves a trusted companion.`

Supporting text:
`Whether you're planning a journey for someone you love or you're ready to help someone travel with confidence, TravelBuddy is here.`

Buttons:
- Get started
- Become a companion

Use subtle Earth/space atmosphere.

# FOOTER

Minimal premium footer.

Brand:
`TravelBuddy.`

Tagline:
`Safe journeys. Trusted companions.`

Links:
- How it works
- Families
- Companions
- Safety
- Sign in

Legal:
- Privacy
- Terms
- Contact

# TYPOGRAPHY

Preferred:
- Space Grotesk for brand, hero, section headings, major cards
- Inter for body, nav, buttons, normal UI
- JetBrains Mono sparingly for eyebrow labels, numbers, metadata

Hero typography should feel cinematic, not simply bold.

# COLOR DIRECTION

Base: `#07080d`

Chrome:
`#ffffff`
`#eaeefb`
`#b7c0d8`
`#818ca9`

Accents:
- electric blue
- cyan
- subtle hot magenta

Use accents mainly for lighting and interaction.

# MOTION

Keep motion subtle:
- very slow Earth rotation if practical
- gentle stars/particles
- CTA glow on hover
- card lift on hover
- smooth section entrance
- navbar transparency change on scroll

Do not over-animate. Performance matters.

# RESPONSIVE

Desktop target: ~1440px.

Mobile must be single-column with no horizontal scrolling.

Mobile order:
1. Navigation
2. Eyebrow
3. Hero headline
4. Hero copy
5. CTAs
6. Trust line
7. Earth
8. Trust strip
9. How it works
10. Families
11. Companions
12. Safety
13. Matching
14. Final CTA
15. Footer

# IMPLEMENTATION BOUNDARY

Inspect ONLY the minimum landing-page files required:
- `src/app/page.tsx`
- `src/app/layout.tsx`
- landing-page-related components imported by `page.tsx`
- relevant global CSS / Tailwind configuration
- relevant assets under `public/`

Only modify frontend/visual files required for the landing page.

If a backend issue is discovered, report it instead of changing backend logic.

# VALIDATION

After implementation:
1. TypeScript check
2. ESLint
3. Production build
4. Open the actual page in a browser
5. Inspect the rendered page visually
6. Check desktop at ~1440px
7. Check mobile
8. Check horizontal overflow
9. Check CTA navigation
10. Confirm `/auth/sign-in` and `/auth/sign-up` still work

Compilation alone is NOT proof of success.

# SUCCESS CRITERIA

The redesign is successful only when:
- hero is clearly two-column on desktop
- large realistic Earth is present
- Earth is the main hero visual
- CTA buttons are compact and attractive
- navbar is aligned
- sections use real visual compositions
- How it works uses cards
- Family and Companion use split layouts
- Safety uses a polished grid
- Matching looks like a product visualization
- no fake logos are used
- no horizontal overflow exists
- page feels like a premium startup
- existing authentication/backend functionality remains untouched

## FINAL INSTRUCTION

Do NOT spend time understanding the entire TravelBuddy repository.

Use this document as product/architecture context.

First report the landing-page files you will inspect/change.
Then implement the visual redesign.
Do not modify unrelated files.
