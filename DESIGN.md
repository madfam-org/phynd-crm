---
name: PhyndCRM
description: MADFAM's own CRM: a dense, calm work surface that puts the next person to contact on top
colors:
  background: "#ffffff"
  foreground: "#0a0a0a"
  muted: "#f5f5f5"
  muted-foreground: "#666666"
  border: "#e5e5e5"
  brand: "#2c8136"
  brand-foreground: "#ffffff"
  brand-soft: "#e8f3ea"
  brand-ink: "#1f5e27"
  brand-purple: "#58326f"
  selection: "#ede4f3"
  tier-a-soft: "#e8f3ea"
  tier-a-ink: "#1f5e27"
  tier-b-soft: "#fdf3d0"
  tier-b-ink: "#6e5200"
  tier-c-soft: "#f1f1f1"
  tier-c-ink: "#525252"
  danger-soft: "#fdecec"
  danger-ink: "#a4161a"
  warning-soft: "#fdf3d0"
  warning-ink: "#6e5200"
  dark-background: "#0a0a0a"
  dark-foreground: "#fafafa"
  dark-muted-foreground: "#a3a3a3"
  dark-brand: "#5cb868"
  dark-brand-soft: "#15301a"
  dark-brand-ink: "#9bdba4"
  dark-tier-b-soft: "#3a2e08"
  dark-tier-b-ink: "#f2cf5b"
  dark-danger-soft: "#3b1214"
  dark-danger-ink: "#ffa3a3"
typography:
  page-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  section-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  tier-a:
    backgroundColor: "{colors.tier-a-soft}"
    textColor: "{colors.tier-a-ink}"
    rounded: "{rounded.sm}"
  tier-b:
    backgroundColor: "{colors.tier-b-soft}"
    textColor: "{colors.tier-b-ink}"
    rounded: "{rounded.sm}"
  tier-c:
    backgroundColor: "{colors.tier-c-soft}"
    textColor: "{colors.tier-c-ink}"
    rounded: "{rounded.sm}"
  sla-overdue:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.full}"
  sla-due-soon:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.full}"
---

# Design System: PhyndCRM

> Started 2026-11-17 with the `/leads` redesign. The tokens below are live in
> `apps/web/src/app/globals.css` (`@theme`, `.dark`). Surfaces adopt them as they are redesigned
> (`claudedocs` plan, Phase B). The shared primitives (`components/ui/*`) keep the incumbent
> neutral language until the Phase A foundation PR moves them.

## Overview
An **Operate** surface for MADFAM staff. The incumbent world stays: shadcn/ui on a neutral
ground with Inter. It is precise, quiet and data-dense, with familiar controls. MADFAM shows up
in the details only: the brand green for the one primary action and for tier A, brand purple
for selection, and the brand yellow (deepened for contrast) for tier B and due-soon. Colour
always means something (tier, deadline, consent). Nothing is decorative.

**Signature move: the deadline clock.** On a lead surface the first-contact deadline is the
spine of the screen. The queue is ordered by it. Each row leads with a pill that counts down
("Vence en 3 h") or up ("Vencida hace 2 d"), and an overdue row carries a faint danger tint
across its whole width. The lead page repeats the same pill next to the next step.

## Colors
Tokens are defined for light and dark (`.dark`) and named by job, not by hue.

### Primary
- **brand** `#2c8136` (dark `#5cb868`): the one primary action per view, the tier-A mark, and
  "done". White text on brand is 4.9:1.

### Secondary
- **brand-purple** `#58326f`: selection only (`::selection`, selected rows via `selection`
  `#ede4f3`). Never a second button colour.

### Tertiary
- **brand yellow**, deepened: `tier-b-ink` `#6e5200` on `tier-b-soft` `#fdf3d0` is 7:1. The raw
  `#eebc15` never carries text.

### Neutral
The incumbent shadcn neutrals (`background`, `foreground`, `muted`, `border`). Secondary text
is `muted-foreground` `#666666` (5.7:1 on white). It replaces `#737373` (4.7:1) wherever this
system is adopted.

### Named Rules
- **State colours only where state exists.** Danger means overdue, unsubscribed or suppressed.
  Warning means due soon. Brand means tier A or done. Nothing else is coloured.
- **Masked values read as withheld.** They show in `muted-foreground`, italic, with a lock
  icon and the label «oculto». Never raw asterisks in body colour.

## Typography
Inter for everything. Tabular numerals (`tabular-nums`) are used for scores, counts, times and
money.

### Hierarchy
- **page-title** 24/600, tracking −0.015em. One per page.
- **section-title** 15/600, for card and panel titles.
- **body** 14/400, line height 1.5. Messages stay under a 70ch measure.
- **meta** 12/500, for row metadata, chips and timestamps.

## Layout
- 4 px base grid. Row height in dense tables is 52 px, enough for a two-line cell (name over
  company).
- Below 768 px, tables become stacked cards with the same order and the same pills.
- Page gutters are 16 px on phones and 24 px from `md`.
- The work area is never capped at a reading width: a queue uses the screen.

## Elevation & Depth
Flat. Borders (`border` token) separate regions. Shadows appear only on popovers and menus,
offset with a soft blur (`0 4px 16px -4px rgb(0 0 0 / 0.12)`). Nothing glows.

## Shapes
Radius 6 px for controls, 8 px for panels, 4 px for tier marks. Pills (deadline, consent) are
fully rounded. No coloured side borders on cards or rows.

## Components

### Buttons
The incumbent `Button`. `variant="default"` uses brand on lead surfaces (one per view). Icon
buttons always carry an `aria-label`.

### Chips
- **View tabs:** a segmented row of links with counts in tabular numerals. The current view has
  `aria-current="page"`.
- **Tier mark:** a 4 px-radius block, letter plus score («A · 9»). Its tooltip lists the score
  parts.

### Cards / Containers
One level only. The lead page uses bordered panels with a section-title. Panels are never
nested.

### Inputs / Fields
Incumbent shadcn inputs and selects. Every control has a visible label or an `aria-label`.

### Navigation
The incumbent sidebar is unchanged in this pass.

### Deadline clock (signature)
A pill with a clock icon in five states:
- **overdue:** danger, «Vencida hace …»;
- **due-soon:** less than 4 h, warning, «Vence en …»;
- **on-track:** muted, «Vence …»;
- **done:** brand, «Contactado»;
- **none:** a dash.

Pure logic lives in `apps/web/src/components/leads/sla.ts`.

## Do's and Don'ts

### Do:
- Put the next person to contact first, and say why (deadline, tier, score parts).
- Use the product's Spanish: «Asignar a…», «Primer contacto», «Vencida».
- Theme the browser surfaces from the palette: selection, focus ring, tabular numerals.
- Show honest placeholders («Sin datos de empresa todavía»).

### Don't:
- Borrow Dhanam's tri-material palette.
- Use a coloured `border-left` above 1 px, gradient text, glassmorphism, or eyebrow labels.
- Send anything automatically. Contact actions only open the user's own client.
- Show raw asterisks for masked data.
