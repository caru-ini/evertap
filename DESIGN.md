---
version: alpha
name: evertap
description: "A light-grey interface for dispensing databases and object storage. Figtree labels and names, JetBrains Mono values, engine groups, connection details ready to copy, and disk space always visible. A cool surface ladder with hairline borders, compact controls, and a single cobalt focus signal."

colors:
  canvas: "oklch(98.5% 0.003 250)"
  surface-1: "oklch(96.5% 0.004 250)"
  surface-2: "oklch(94% 0.005 250)"
  hairline: "oklch(90% 0.006 250)"
  hairline-strong: "oklch(84% 0.008 250)"
  ink: "oklch(20% 0.01 250)"
  ink-muted: "oklch(42% 0.01 250)"
  ink-subtle: "oklch(50% 0.012 250)"
  primary: "oklch(20% 0.01 250)"
  on-primary: "oklch(98.5% 0.003 250)"
  signal: "oklch(52% 0.19 262)"
  led: "oklch(62% 0.17 150)"
  led-ink: "oklch(44% 0.1 150)"
  led-surface: "oklch(95.5% 0.03 150)"
  amber: "oklch(75% 0.16 80)"
  amber-ink: "oklch(46% 0.12 70)"
  amber-surface: "oklch(96% 0.035 85)"
  fault: "oklch(55% 0.2 27)"

typography:
  page-title:
    fontFamily: Figtree
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.02em
  dialog-title:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.01em
  resource-name:
    fontFamily: Figtree
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: 0
  body:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: Figtree
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  caption:
    fontFamily: Figtree
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 0
  label:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  button:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0
  chip:
    fontFamily: Figtree
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  value:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
    fontFeature: "tnum"
  value-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
    fontFeature: "tnum"

rounded:
  xs: 3px
  sm: 4px
  md: 8px
  lg: 12px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  content-max: 896px
  sidebar: 256px
  sidebar-rail: 48px

components:
  engine-option:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 72px
    padding: 0 12px
  engine-option-selected:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 72px
    padding: 0 12px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  button-destructive:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.fault}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 10px
  url-field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.value}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 4px 0 12px
  copy-confirmation:
    textColor: "{colors.led}"
  resource-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: 8px
  button-secondary-pressed:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  divider:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    height: 1px
  frame-line:
    backgroundColor: "{colors.hairline-strong}"
    textColor: "{colors.ink}"
    height: 1px
  meter-ring-warning:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    size: 22px
  extension-picker:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.value}"
    rounded: "{rounded.md}"
    padding: 4px 8px
  extension-chip:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.sm}"
    padding: 0 6px
  format-switch:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.value}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 10px
  format-switch-selected:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.value}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 10px
  status-chip:
    backgroundColor: "{colors.led-surface}"
    textColor: "{colors.led-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.sm}"
    padding: 0 6px
  temporary-chip:
    backgroundColor: "{colors.amber-surface}"
    textColor: "{colors.amber-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.sm}"
    padding: 0 6px
  host-chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.chip}"
    rounded: "{rounded.sm}"
    padding: 0 6px
  sidebar-item:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 8px
  sidebar-item-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 8px
  disk-meter:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 2px
  dialog:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 16px
  menu:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 4px
  data-grid-head:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.value-sm}"
    padding: 6px 12px
  data-grid-cell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.value-sm}"
    height: 36px
    padding: 0 12px
  null-marker:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.chip}"
    rounded: "{rounded.sm}"
    padding: 0 4px
  staged-cell:
    backgroundColor: "{colors.amber-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.value-sm}"
    height: 36px
    padding: 0 12px
  unsaved-bar:
    backgroundColor: "{colors.amber-surface}"
    textColor: "{colors.amber-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  data-nav-item-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.value-sm}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 8px
---

# evertap — design system

The locked system for this app. Every screen reads this file before emitting UI; the CSS in
`packages/ui/src/styles/globals.css` is the implementation of these tokens (same OKLCH values as CSS
custom properties). Extend this file first, then the CSS.

## Overview

evertap is the one box on a home server that hands out databases and object storage. The people who open it are
a developer starting a project and, through the planned MCP interface, the agent doing it for them.
They need connection details for a database or a bucket. The interface should feel like the front
panel of a well-made appliance in daylight:
a light grey panel, labels printed in a plain engineering face, one signal colour that only ever
means "here" or "this one", and green only for a safe state. Dense enough to be a tool, calm enough to
be left running.

The primary user is a developer creating a local resource, returning for its connection details,
or removing an experiment. The planned MCP interface shares the same API rules. Grouping answers
which engine a resource belongs to; the row's copy action and the resource page's connection panel
answer how to use it. Disk space and deletion protection stay available without crowding the
connection action.

The current implementation is an in-memory demo for all four engines: PostgreSQL, MySQL, Redis,
and Garage. Creation, listing, details, deletion, protection, and Keep update sample data;
they do not start real services. When `system.status.mode` is `demo`, the UI states: "Demo data —
changes reset on restart. Connection details are examples."

Supabase's official Studio guidance informs the separation of app surfaces, fields, and overlays.
Neon's connection workflow informs the copy panel. Third-party analyses of the Supabase and Neon
sites describe marketing pages, so their palettes and page layouts are not application requirements. evertap retains its own light surface ladder, hairlines,
compact controls, and scarce accent.
Notion's [sidebar documentation](https://www.notion.com/help/navigate-with-the-sidebar) informs
grouped sections and hover actions; evertap does not nest resources under an engine. Component sizes follow the components in `packages/ui`;
Notion is a layout reference, not a source of pixel measurements.

The people who connect an agent already work in Claude Code, Cursor, Codex, VS Code, or Zed.
Duply's analyses of Claude, Cursor, OpenAI, and Zed (also marketing pages, stored beside the others)
inform the MCP Server dialog. What they share is already evertap: an ink primary action, chrome
without brand colour, an accent kept to links, hairlines before shadows. Claude's plan toggle lifts
its selected segment one surface step, which is evertap's format switch. Cursor, OpenAI, and Zed put the
working thing itself — a product window, a prompt box, real code — where a page would otherwise
explain, so the agent's setting is the dialog's main content, ready to copy. Their fonts, warm and
blue-grey palettes, pill buttons, serif headlines, and shadows are not adopted.

## Colors

One cool hue (250) carries every neutral; only lightness changes between steps. Colour otherwise
means state.

- **Canvas** ({colors.canvas}): The main page. Near-white with a trace of blue, never pure white.
- **Surface 1** ({colors.surface-1}): One step down — the sidebar, hover fills on the main page, secondary buttons, the meter track.
- **Surface 2** ({colors.surface-2}): Two steps down — pressed controls and sidebar hover/active rows.
- **Hairline** ({colors.hairline}): Row dividers, the sidebar seam, menus and dialogs.
- **Hairline Strong** ({colors.hairline-strong}): Inputs, the URL field, chips — edges the eye must find.
- **Ink** ({colors.ink}): Titles, names, values, and the primary button fill.
- **Ink Muted** ({colors.ink-muted}): Descriptions, labels on chips.
- **Ink Subtle** ({colors.ink-subtle}): Meta lines and helper text; still 4.5:1 on Surface 1.
- **Signal** ({colors.signal}): Cobalt. Focus rings and links. Sidebar selection uses a neutral row background and stronger text weight.
- **LED** ({colors.led}): Green. The check mark a copy button shows after copying.
- **LED Ink / LED Surface** ({colors.led-ink}, {colors.led-surface}): The Protected chip — a safe
  state, so green rather than amber. A pale fill with no border keeps it quieter than the name.
- **Amber / Amber Ink / Amber Surface** ({colors.amber}, {colors.amber-ink}, {colors.amber-surface}): Warnings — low disk, a temporary resource. The surface and ink pair keeps warning text readable.
- **Fault** ({colors.fault}): Delete and destructive confirmations; a machine meter at 90% used or more.

### Dark theme

Theme in the sidebar header picks System, Light, or Dark; System (the default) follows the OS.
Dark keeps every role and hue above and only moves lightness: the surface ladder climbs (Surface 1
and 2 are lighter than Canvas, as a lit panel reads), ink is light, and the state colours rise so
their text stays readable. The primary button stays an Ink fill, so it turns light with dark text.

| Token                             | Dark value                                                             |
| --------------------------------- | ---------------------------------------------------------------------- |
| canvas                            | `oklch(17% 0.006 250)`                                                 |
| surface-1                         | `oklch(20.5% 0.007 250)`                                               |
| surface-2                         | `oklch(24.5% 0.008 250)`                                               |
| hairline                          | `oklch(28% 0.008 250)`                                                 |
| hairline-strong                   | `oklch(36% 0.01 250)`                                                  |
| ink                               | `oklch(94% 0.004 250)`                                                 |
| ink-muted                         | `oklch(78% 0.008 250)`                                                 |
| ink-subtle                        | `oklch(67% 0.01 250)`                                                  |
| signal                            | `oklch(70% 0.15 262)`                                                  |
| led / led-ink / led-surface       | `oklch(72% 0.17 150)` / `oklch(80% 0.12 150)` / `oklch(27% 0.045 150)` |
| amber / amber-ink / amber-surface | `oklch(80% 0.15 80)` / `oklch(84% 0.12 80)` / `oklch(28% 0.045 80)`    |
| fault                             | `oklch(66% 0.19 27)`                                                   |

## Typography

Figtree for labels, prose, and names (resources, clients), JetBrains Mono for anything a person
copies or compares: connection details, sizes, counts, and the data browser's identifiers. Sidebar labels use Figtree 14px
as navigation. Two families, no third.
Both are bundled through Fontsource with 400, 500, and 600 weights (Figtree also 700, for the
18px wordmark alone); normal rendering does not
depend on fonts installed on the device. Code ligatures are disabled in connection strings.

- **Page title** ({typography.page-title}): 20px at 600 with tight tracking — the only 600 on a screen besides dialog titles.
- **Dialog title** ({typography.dialog-title}): 16px at 600.
- **Resource name** ({typography.resource-name}): 15px at 500 for resource and client names in rows. Sidebar labels use Body, or Label when active.
- **Body** ({typography.body}) and **Body small** ({typography.body-sm}): 14px and 13px at 400 for copy and descriptions.
- **Caption** ({typography.caption}): 12px meta lines with tabular numerals.
- **Label / Button** ({typography.label}, {typography.button}): 14px at 500.
- **Chip** ({typography.chip}): 11px at 500 for pills and the host chip.
- **Value** ({typography.value}): Mono 14px (`text-sm`) for connection strings and numbers, tabular figures on.
- **Value small** ({typography.value-sm}): Mono 13px for the data browser — grid cells, table and key names, and SQL. Redis value and score boxes follow the input size (14px).

Weight does the hierarchy: 600 / 500 / 400. Size steps are small (11 · 12 · 13 · 14 · 15 · 16 · 20).
Display sizes above 20px do not exist in the app.

## Layout

A collapsible sidebar ({spacing.sidebar} wide, {spacing.sidebar-rail} as an icon rail) on the left,
with Surface 1 behind the navigation and a hairline at the content edge. Content sits in a {spacing.content-max} column
with {spacing.lg} side padding on desktop and {spacing.md} on mobile. Below 768px the sidebar becomes
a sheet behind a sticky 48px top bar; the machine meter stays in the sheet's footer. Touch copy and format controls are 44px tall; desktop
controls use the Button size variants: ordinary buttons use `lg` (36px), and secondary actions use
`default` / `icon` (32px). `SidebarMenuButton` is 32px.
The sidebar header is 48px tall. Use these component defaults instead of a separate density scale.
The data page (`/resources/$id/data`) is the one route that drops the {spacing.content-max} limit
(route `staticData.wide`): tables are wide, so its column, and the banners above it, use the full
content width with the same side padding. Every other page keeps the reading column.

A 4px base scale: {spacing.xxs} · {spacing.xs} · {spacing.sm} · {spacing.md} · {spacing.lg} ·
{spacing.xl} · {spacing.xxl}. Rows are one line, at least 48px tall, padded
{spacing.xs} and divided by hairlines; page sections sit {spacing.lg} apart.

Lists, not cards. A resource is a ruled, one-line row in aligned columns: name and chips, note,
size, last used, then a copy action and the ⋯ menu. One header above the list names the columns.
Nothing inside a row is boxed; the connection field lives on the resource page and in the creation
dialog. Columns follow the width of the content area, not the viewport, because the sidebar takes
space when open: under 576px the row stacks name over a size · last used line and keeps only the ⋯
menu, which still copies. From 576px the note sits under the name and the copy action is an icon;
its label appears from 672px. Chips never start a line: from 576px they follow the name, and in
stacked rows the size · last used line, so the text under the name always starts flush with it.

### Screens

The list is for finding a resource; from 576px every row still copies its connection in one click.
A masked URL repeats the resource name and made rows hard to scan, so the row keeps the copy action (the
database URL, or a bucket's `.env` values) and leaves the value itself to the resource page.
All resources (`/`), an engine (`/?engine=xxx`), and a resource (`/resources/$id`) each have
their own page; the sidebar links to the first two. Back links climb one level: a resource returns
to its engine, an engine to All resources.

- **Sidebar**: Resources is the top-level destination. Databases contains PostgreSQL, MySQL, and
  Redis; Object storage contains Garage. Each engine is one row with its icon and name.
  No resources are nested under an engine: a few of them read as all of them, and All resources
  and the search menu already show what was used recently. Hover and active rows use Surface 2;
  active text uses weight 500. The collapsed rail keeps
  the engine icons. Selecting a destination closes the mobile
  sheet. A "Search" row drawn as a field (Canvas fill, Hairline Strong edge, Ink Subtle label) with its
  key hint (⌘K, or Ctrl K off macOS) sits first, then "All resources"
  and "New resource", before the groups.
  Each engine row has a + action that opens creation with that engine selected; it appears on row
  hover or focus on desktop and stays visible on touch devices. The engine name opens the engine's
  page. An engine row is active on its own page and on the page of any of its resources. Menu
  rows have 4px gaps.
  The header holds the brand, then Theme as an icon button (the current choice's icon; a
  System / Light / Dark menu) beside the collapse trigger; the rail hides Theme.
  The footer holds Clients and Settings, then a CPU / Memory / Disk status row, apart from the
  resource pages; the collapsed rail keeps their icons and the ring. Clients is a page
  and is active on `/clients` and `/device`; Settings is active on `/settings`. The status row ends in an Ink Subtle caret, so it reads
  as the way into Doctor rather than a static readout.
  Desktop collapse keeps the trigger anchored to the right edge and the footer at a fixed height;
  the panel, spacer, and heading use the same 200ms easing curve
  (`cubic-bezier(0.22, 1, 0.36, 1)`). Hidden links leave the tab order. Mobile sheets translate their
  full width off the left edge without fading the panel. Reduced motion removes the transitions.
- **List** (`/`): Resources, grouped by engine. A Surface 1 band with the icon, engine name, count,
  and + heads each group, 4px above its first row so a hovered row never joins the band; the name
  links to the engine's page. Engines without resources are left out, and with no resources at all
  the page says what to create. The whole row opens `/resources/$id`. Row menus offer the engine's
  copy formats, protect / unprotect, Keep for temporary resources, and delete. Generic
  "New resource" opens the creation dialog in place.
- **Engine page** (`/?engine=xxx`): the same rows for one engine, without bands. The title is the
  engine's mark and name, the button reads "New database" or "New bucket" and opens Details with
  that engine selected (as do the band and sidebar + actions), and a back
  link returns to All resources. An engine without resources says so and points at the button.
- **Create**: a two-step "New resource" dialog over the current page, with no URL. Without an
  engine, start at Service; choosing a service opens Details. An engine-specific creation action starts
  at Details with that engine selected. Back uses an arrow icon and returns to Service, where the
  engine can be changed while preserving the entered name, note, and extensions.
  A full-width Service / Details progress bar uses two thin, equal segments below the title and a
  check icon for the completed step. Only the current segment has a dark line; inactive and completed
  segments have a light line. Current state also uses stronger text and `aria-current="step"`.
  The completed Service segment is clickable and keyboard accessible, returning to selection without
  clearing the form. Hover and focus show it is interactive; creation in progress disables it.
  Service selection is one button per service, with no Continue, in two sections:
  Databases (PostgreSQL, MySQL, Redis, using svgl marks) and Object storage (Garage, using its
  official mark from `apps/web/public/brands/`). These four services are the MVP scope. All options
  have the same 72px height. Three columns on desktop, two on mobile. Nothing is preselected;
  returning from Details marks and focuses the service chosen last. A service missing from
  `system.status.engines` stays in place but is disabled, its mark dimmed and its summary reading
  "Not available yet"; an engine action for it starts at Service. All four can be created
  in the demo. The details form has name and note; storage
  uses the name for its bucket. Databases add Version, a format switch of the supported major
  versions with the newest selected, so creating still needs only a name. The resource page
  prints the version beside the engine name. Only PostgreSQL has an extension picker — a multi-select combobox
  that searches the API's available extensions, with chosen ones shown as chips. The demo provides
  a sample extension catalog; the PostgreSQL driver will query `pg_available_extensions`.
  On success the same dialog shows its connection panel directly from the creation response:
  databases use URI / .env / an engine-specific CLI (`psql`, `mysql`, or `redis-cli`), while storage
  uses Credentials / .env / AWS CLI. Credentials gives endpoint, bucket, region, access key ID, and
  secret access key their own copy fields. The resource page shares this panel. Native radio inputs
  support Tab and arrow keys; changing format resets secret reveal and copy confirmation. Failed extension loading
  offers Retry, while creation without extensions remains available.
- **Delete**: a shared alert dialog; a protected resource must be re-typed by name. Deleting the
  resource currently open returns to the list filtered to that engine.
- **Search**: a command dialog opened by ⌘K / Ctrl+K or the sidebar's Search row, with no URL of
  its own. Empty, it lists the five most recently used resources and the pages; typed text matches
  resource names across engines, grouped by engine with the mark, name, and engine label on
  each row. Enter opens the resource page. It does not open over another dialog.
- **Clients** (`/clients`): a top-level page like All resources, so it has no back link. The page is for
  managing what already has access; adding happens elsewhere, reached from the header: an outline
  "Add a device" link to `/device` (a browser signing in and `evertap login` both show a code) and
  the primary "New API key" dialog button. Below the title, a sentence
  that says to revoke what is no longer used. From nine clients up, a "Filter by name" field and a
  Newest / Least recently used switch appear above the list; least recently used puts never-used
  clients first. While filtering, each band counts `2 of 62`.
  The same list language as resources: one column header (Name, Last used, IP address, Added), a Surface 1 band
  per kind with its icon, name, and count, then one-line rows with the name. The IP address is
  where the last call came from (mono, `—` when never used); it is a column from 768px of content
  width and joins the "Last used … from …" line on narrow rows. The row's one action, Revoke…, sits
  in a ⋯ menu that appears on row hover or focus and stays visible on touch, so the word is not
  repeated down the page; rows take the list's Surface 1 hover fill.
  Rows are not links; a client has no page. Each band has a + action: Browsers and CLI open `/device`,
  API keys opens the dialog. Revoke asks in an alert dialog that says what stops working and, because a
  machine paired twice has two rows with one name, when the client was added, last used, and from
  which address. The row
  leaving is the feedback.
- **New API key**: a dialog with one name field. On success the same dialog shows the key as an
  `.env` line in the large URL field, masked, with a primary copy button and the sentence "Copy the
  key now. evertap does not keep it, so it cannot be shown again."
- **Settings** (`/settings`): a top-level page like Clients, so it has no back link. The title,
  one line on what it covers, and at the right the primary "Change access". Doctor's band language
  without the lights: an Access band with label / value rows for Opened from (the choice's icon and
  name, with where the UI listens and who can reach it as the note under it), Address (mono at
  16px, "Sign-in links point here"), the tunnel's state when evertap runs one, and Buckets; then a
  Databases and buckets band, a sentence on how apps reach them and one mono row per engine with
  where its entry listens. A value an environment variable sets says "Set by `EVERTAP_MODE` where
  evertap runs" under it with a lock, in Ink Subtle; only when those fix everything there is to
  choose is there no Change access, and the page says where to change it instead. When the UI
  listens where the internet reaches it, the Access band ends with that warning on an amber rule
  (Amber Ink beside a 2px Amber line). Behind the person's own proxy or tunnel, a Your proxy band
  follows Access: a sentence naming the address and where the proxy passes requests on to (both
  mono), a Caddy / nginx switch over the configuration in the large URL field with its primary copy
  button, and an outline "Check the address" that answers in place: the address in LED Ink after a
  filled check when it reaches evertap, or what the proxy should change, one item each, on the
  amber rule.
- **Change access**: a dialog in two steps. First one question, "Where will you open evertap
  from?", as four option rows named, worded, and ordered as `evertap setup` asks: This computer
  only (Laptop), Devices on your network (WiFi), Anywhere, through Cloudflare (Cloud), Behind your
  own proxy or tunnel (Share Network, as the Your proxy band). Each row has its icon at the left
  in Ink Subtle (Ink when chosen), the name with the address it opens evertap at in mono beside
  it where that is known, its one-line hint, and the check at the right; the chosen one Surface 2
  with a Hairline Strong edge. Only what the chosen row needs follows it: Devices on your network
  folds "Use another address" and "Buckets reached from anywhere" behind caret triggers, with a
  warning on an amber rule when it opens evertap to the internet; Behind your own proxy or tunnel
  asks "Where does it run?" (On this machine, and In Docker where Docker has a bridge) as the same
  rows, then its Address, with buckets folded as above. Anywhere, through Cloudflare continues to
  the tunnel's own steps (`components/cloudflare-tunnel.tsx`). What an environment variable sets
  shows as its value with the lock line instead of a control, and choices it rules out are not
  offered, with the lock line under the rows. Continue asks the API without saving, then the second
  step shows "Browsers will open evertap at" with the choice's icon and the new address in a
  Hairline Strong box, and a line or two on what changes, with Back and Switch (Save when the
  choice stays). When the change leaves this browser without its way in, the step says so on the
  amber rule (it can no longer open evertap at this host; outside the network it cannot at all
  for Devices on your network) and the button reads "Switch and open <new host>": the page then
  goes to a one-time sign-in link there. When only the machine running evertap, or no known
  address, opens it next, the step says to run `evertap setup` there to change it back, and the
  dialog ends on that. Otherwise success closes the dialog and the page shows the new values.
- **Add a device** (`/device`): a narrow column with a back link to Clients, a sentence naming
  where codes come from (a browser's sign-in page, a terminal that ran `evertap login`), the code
  field (mono, upper case, `XXXX-XXXX`) with Continue, then "Pairing a CLI?" with the
  `evertap login` command in the URL field. Named for the device, as GitHub and Google name theirs,
  and short to type by hand. With a code
  (`/device?code=…`) the title names the request — "Sign in a browser" or "Pair a CLI" — and a
  Hairline Strong box shows the code at 20px mono so it can be compared with the terminal or the
  new browser, the machine or browser name, and when it asked; then Approve (primary) and Deny,
  and a line on what the client can and cannot do. Approving replaces the request with a sentence
  (a browser continues on its own; a CLI's person returns to the terminal); denying returns to Clients. An unknown or expired code shows the code field with the API's message, "Ask for a new code
  and enter it again". In the demo the field points at the seeded example request.
- **Resource page** (`/resources/$id`): a page of its own, never beside the list. One column, sections divided by hairlines — header (back link to the
  engine's page, name, chips, note edited in place — clicking it (a pencil beside it), or a ghost "Add note" when
  empty), Connection (format switch + connection fields), Details (size · created · last
  connected, plus engine-specific fields), a Temporary section with Keep when the resource has
  an expiry, then protection as a switch and the delete button. Only PostgreSQL shows extensions;
  object storage presents bucket connection credentials. Tabs arrive only when routes (LAN · Remote)
  and backups exist. The header's right holds shortcuts in two right-aligned rows of outline
  buttons (36px): named ones that open the data page — Tables and SQL (PostgreSQL / MySQL) or Keys
  (Redis) — above icon-only ones with the action as tooltip and label: copy each connection format
  (link, file, terminal icons; the LED check after copying) and a protection toggle whose shield
  turns LED green and filled while protected. Both rows sit on one four-column grid (columns at
  least 36px), named buttons spanning two or four, so their edges line up. Buckets get only the icon
  row. Under 42rem of header width the named buttons drop below the name as a full-width row of
  44px touch targets and the icon row goes: touch has no tooltip to name an icon, and the connection
  panel just below copies every format. The data buttons show in the demo too, where the data page
  says there is nothing to browse.
- **Data** (`/resources/$id/data`): a page of its own, reached from the resource page, whose back
  link (the resource's name) climbs one level to it. The title is "Tables" or "Keys"; a meta
  line gives the engine mark, name, and resource name. Below one
  Hairline, two panes split by a Hairline: a list on the left (15rem for tables, 20rem for keys),
  the chosen item on the right. Under 896px (tables) or 768px (keys) of content width the list
  stacks above, capped in height with its own scroll.
  PostgreSQL / MySQL: the list starts with "SQL console", then "Tables" and its count, one 32px row
  per table in mono with the planner's `~1.2k` estimate or "view" in Ink Subtle; the chosen row is
  Surface 2 and weight 500, like the sidebar. Schemas head their tables only when there are two or
  more. The URL holds the choice (`?schema=&table=`, `?sql=true`), no choice opens the first table,
  and a database without tables opens the console. A table: mono name, a View tag for views, then
  at the right the selection actions, Filter and Add row (both outline; Filter shows the applied
  count). The one primary is Save changes in the unsaved-changes bar. Views and tables without a primary key print one line saying they are read-only and
  what to do instead, and get no checkboxes or Add row. Filters open under the toolbar as rows of
  column select · operator select (equals, does not equal, is less than, is greater than,
  contains, is NULL, is not NULL) · value, joined by "Where" / "and", up to ten, applied together
  by Apply or Enter. The grid (`data-grid-head`, `data-grid-cell`) scrolls inside itself in both
  directions up to 70% of the viewport height, with a sticky Surface 1 header whose cells carry the
  column name (a key icon for primary-key columns, a caret when sorted) over its type in Ink Subtle
  (" · not null" when required); clicking a header sorts ascending, descending, then not at all.
  Rows and columns are divided by Hairlines; numbers align right; NULL is a `null-marker` tag.
  100 rows per page; under the grid, "1–100 of 1,234" in mono and previous / next icon buttons.
  Editing opens a small editor over the cell (Canvas, Hairline Strong ring): a growing mono
  textarea, a hint line, and Set NULL for nullable columns. Row edits are staged, never written
  one at a time: an edited cell takes Amber Surface (`staged-cell`), "Delete N rows" (no ellipsis,
  no dialog) strikes the rows through in Ink Subtle with an undo arrow in place of the checkbox, and
  Add row pins an empty Amber Surface row at the top with an × to drop it and a Default tag
  (`null-marker` style) in each column left to the database. Selected rows take Surface 1. While
  anything is staged, the `unsaved-bar` sticks to the bottom of the table area: "3 unsaved changes ·
  1 edited · 1 deleted · 1 new" in Amber Ink, then Discard (outline) and Save changes (primary,
  ⌘S / Ctrl S). A failed save keeps everything staged and puts the API's message under the count
  in Fault. The console is a mono textarea, a primary Run with
  its ⌘↵ / Ctrl ↵ hint, one line on whose user runs it, then the result: "12 rows · 4 ms" in mono,
  an amber line when rows were cut at 1,000, and the same grid read-only; a failure shows the
  engine's message in Fault mono under a 2px Fault rule.
  Redis: a pattern field (mono, default `*`, with one line on `*` and `?`), Search, and the primary
  New key. The key list shows each key in mono with its type and TTL in Ink Subtle, a "Keys 120+"
  count, and a ghost "Load more" row while the scan has more. The chosen key (`?key=`) shows its
  mono name, a meta line (type · size · expiry), Delete key…, then its value by type: a string
  textarea; hash field / value rows; list items numbered from 0; set members; sorted-set score /
  member rows; each with remove and add. Expiry is the format switch (No expiry / Expires after)
  with a seconds field. Save (primary) writes a changed value with its expiry, or only the expiry;
  Discard changes appears once something changed; problems replace the helper line in Fault. A
  value cut at 1,000 items is read-only with an amber line saying to use a Redis client, values the
  browser cannot show say so, and both keep the expiry editable.
  New key is a dialog with the key, a type switch, and the first value; a taken name is refused
  under the key field.
  In the demo the page says the demo has no data and to run evertap with Docker.

## Elevation & Depth

Flat. Hierarchy is the surface ladder (Canvas → Surface 1 → Surface 2) and hairlines; there are no
shadows and no glows. Popovers and dialogs use a 1px hairline ring; a dialog backdrop is a 10%
ink scrim with a slight blur. Focus is a 2px signal ring at 50% opacity outside the control, shown
instantly.

## Shapes

- **{rounded.xs}** (3px): the disk meter track.
- **Square**: list rows and their "All N" / "Show all N" row, hovered or not, so the fill meets
  the straight rules.
- **{rounded.sm}** (4px): the host chip, the Protected and Temporary chips, checkboxes. Chips stay
  square-ish; a pill's round end reads as an indent.
- **{rounded.md}** (8px): every button, input, the URL field, menu items, sidebar items.
- **{rounded.lg}** (12px): dialogs and sheets.

Nesting stays concentric: a dialog at 12px holds controls at 8px.

## Components

- **`button-primary`**: ink fill, canvas text, 36px, 12px side padding. One per screen — the action the page exists for.
- **`button-secondary`** / **`button-outline`** / **`button-destructive`**: Surface 1 fill (Surface 2 when pressed), a 1px Hairline Strong outline, or fault-coloured text on canvas. Same height and radius as primary so rows of buttons align.
- **`text-input`**: 36px, 1px Hairline Strong border that never changes width; focus is the signal ring. Labels sit above; helper text below; an error replaces the helper in the same slot.
- **`extension-picker`** / **`extension-chip`**: the creation dialog's extension field — a 1px Hairline Strong box holding chips for the chosen extensions and a search input; the popup lists `name` in mono with the extension's comment in Ink Subtle.
- **`format-switch`** / **`format-switch-selected`**: native radios using the standard 32px button size for the resource's connection formats. Database formats are URI / .env / engine CLI; storage formats are Credentials / .env / AWS CLI. Code format labels are mono; the selected label is lifted to Surface 1. One Tab stop per group, arrow keys change the selection, and focus is visible around the label.
- **`url-field`**: 1px Hairline Strong border; a connection value as a read-only field with passwords and secret access keys masked as `********` (an eye button reveals them) and a ghost copy button inside; copy always takes the real value, and the button label swaps to Copied with a green check (`copy-confirmation`) for 2.5s instead of a toast. The same field presents individual storage credentials, an agent's MCP setting, the `evertap login` command, and a new API key.
- **`resource-row`**: one-line rows divided by straight 1px Hairline rules, holding the name with chips after it, the note under it, size, and last used in aligned columns; a ghost copy button and a ⋯ menu at the right (copy connection details · protect · Keep when temporary · delete). The hover fill is square, like the rule.
- **`status-chip`** / **`temporary-chip`**: Protected — LED Surface fill, LED Ink text and
  shield. Temporary — the same chip in Amber Surface and Amber Ink with a timer mark
  ("Temporary · deleted in 2 days", "2 days left" in rows): amber because it counts down to
  deletion. Both have 4px corners and appear in rows and on the resource page.
- **`host-chip`**: `evertap.local` next to the wordmark — a printed label with a 1px Hairline Strong edge.
- **`sidebar-item`** / **`sidebar-item-active`**: standard 32px menu rows on Surface 1. An engine row has its database or storage mark and label. Hover and active use Surface 2; active adds weight 500. Full-width row backgrounds express selection without a blue bar.
- **`disk-meter`**: in the sidebar footer, a 32px status row of three cells — CPU, Memory, Disk — each a ring around its icon, filled clockwise by the used share in Ink Subtle, and the used percentage in mono beside it; a cell turns amber from 80% used (disk: under 20% free) and Fault red from 90%. Tooltips give absolute numbers (Disk: free of total). The icon rail keeps one ring: the busiest of the three.
- **`meter-ring-warning`**: a machine-meter ring (22px) strokes Amber from 80% used, and Fault red from 90%.
- **`divider`** / **`frame-line`**: the two 1px lines in the system — Hairline between rows and around popovers, Hairline Strong around inputs, the URL field and chips.
- **`dialog`** / **`menu`**: canvas surfaces with a 1px Hairline ring; 100ms fade and 95% scale in, faster out.
- **`data-grid-head`** / **`data-grid-cell`**: the data browser's table. A sticky Surface 1 header of
  mono column names over their types, 36px rows of Value small cells, Hairlines between rows and
  columns, a Signal ring inset on the focused cell. The grid scrolls inside its own box, never the page.
- **`staged-cell`** / **`unsaved-bar`**: changes not saved yet are Amber Surface, the colour
  of a state that needs attention: edited cells and new rows in the grid, and the sticky bar with a
  40% Amber edge that counts them and holds Discard and Save changes. No new colour; Signal stays for
  focus.
- **`null-marker`**: NULL (or Default, in a new row) as a Surface 2 tag in Figtree Chip type with Ink Subtle text, so it never
  reads as the mono text "NULL".
- **`data-nav-item-active`**: the chosen table or key in the data page's list — the sidebar's active
  row with a mono label.

## Do's and Don'ts

### Do

- Use the signal colour only for focus rings and links.
- Keep every neutral on hue 250; move lightness, not hue.
- Let the resource name be the heaviest thing in a row; everything else is quieter type.
- Say the next action in every error and empty state.
- Stay silent on success when the change is visible; toast only failures and hidden effects.

### Don't

- Don't add shadows, glows, or gradients.
- Don't fill a button or a section with the signal colour.
- Don't put cards inside cards; a row is not a card.
- Don't introduce a third font family or a display size above 20px.
- Don't show the words container, server, image, or port to the user.
