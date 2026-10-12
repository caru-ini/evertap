# evertap — interface system

Tokens, type levels, and component specs live in `DESIGN.md` at the repo root (Google DESIGN.md
format, linted with `bunx @google/design.md lint DESIGN.md`). This file keeps the interaction
patterns that the token file cannot carry. When the two disagree, `DESIGN.md` wins.

## Direction

The front panel of a small appliance, in daylight. A solo developer opens this once per project
to create a database or object storage bucket and copy its connection details; the planned CLI
will let an agent do the same. MVP engines are PostgreSQL, MySQL, Redis, and Garage.
Light grey panel, printed labels in Figtree, identifiers and copied values in JetBrains Mono, one signal colour for position
and focus, green only for a safe state. Both fonts are bundled. Genre: modern-minimal (Hallmark), with a
surface ladder, hairlines, 600/500/400 weights, and 8px control corners. Sidebar labels
use Figtree 14px; resource headings, connection values, and numbers keep JetBrains Mono.

All four engines work through the in-memory `resources.*` demo API. They support creation, listing,
details, deletion, protection, and Keep without starting real services. For `system.status.mode`
`demo`, the UI states: "Demo data — changes reset on restart. Connection details are examples."

## Patterns

- Use the component sizes in `packages/ui`: normal Button `lg` (36px), secondary Button `default` / `icon` (32px),
  SidebarMenuButton (32px). Sidebar width is 256px with a 48px rail;
  top bar and sidebar header are 48px. Avoid a separate set of density overrides.
- Sidebar (`packages/ui` sidebar, `collapsible="icon"`), `panel-2` background, seam on the right.
  Header: `evertap` + host chip, then Theme (an icon-sm ghost button showing the current choice's
  icon, opening a System / Light / Dark menu; hidden on the rail) + trigger. Nav starts with Search, All resources and New resource, followed by Databases
  (PostgreSQL / MySQL / Redis) and Object storage (Garage). Each engine is one row: its icon
  and name link to the engine's page (`/?engine=xxx`), and a + action opens creation with that engine
  selected (shown on row hover or focus; always on touch). No resources are nested under an engine:
  a few of them read as all of them, and All resources and the search menu already show what was
  used recently. The collapsed rail keeps the engine icons; its hidden group labels take no pointer
  events, because the rail pulls them over the row above. Hover and active = panel-3 fill; active adds
  font weight 500. Mobile navigation closes the sheet after a destination is chosen.
  Every sidebar destination is a page: All resources is active on `/`, an engine on `/?engine=xxx`
  and on the page of any of its resources (`/resources/$id`). Menu rows use `gap-1` (4px).
  Footer: when a newer release is out (`system.status.update`), it starts with a standard menu row
  "evertap 0.2.0 is out" with an amber arrow-up icon (the rail keeps the icon, with that as its
  tooltip) that opens Doctor, which says how to upgrade; the release page only lists changes.
  Then Clients (a page, terminal icon) and Settings (a page, gear icon) as standard 32px menu rows, then a status row, not a button, of three cells: CPU,
  Memory, and Disk, each a ring around its icon filled clockwise by the used share, then that share
  as a percentage; each cell turns amber from 80% used and red (Fault) from 90%. Each cell is focusable and its tooltip gives the
  absolute numbers ("19 GB free of 100 GB"). No segmented bar or "free / total" here: beside the
  menu rows it read as a plan's usage quota, and this is the machine's own load. They sit in the footer, apart from the resource pages. A
  print-3 caret closes the row, so it reads as a way into Doctor; on hover it turns print-2. Collapsed, the rows keep their icons and the ring becomes a button that
  opens Doctor; it shows the busiest of the three, and its tooltip gives that one's numbers. The
  expanded row is a link to Doctor too (hover fill, active on `/doctor`).
- Doctor (`/doctor`): bands for Update (only while a newer release is out: an amber light, the
  version linking to its release page in a new tab, and how to upgrade where evertap runs), Docker,
  Engines, Connections, and Machine; each check is a row with
  a state light (LED green, amber, blinking amber while starting, Fault red, Seam off), its name,
  and the verdict, which names the next action when something is wrong. Local-only details
  (paths, start errors) show under the verdict in mono when the API returns them.
- Settings (`features/settings`, `/settings`): Access shows where evertap is opened from (the
  choice's icon and name, the names in `ACCESS_CHOICE_NAMES` that setup and the Doctor use, with
  where the UI listens as a note), the address sign-in links use in larger mono, with a warning when
  the internet reaches where the UI listens, the state of the tunnel evertap runs, and where
  buckets reached from anywhere are served; Your proxy, behind the person's own proxy or tunnel,
  gives the Caddy and nginx configuration to copy (from `system.settings.network`) and checks the
  address on demand (`system.settings.check`, which says what the proxy should change); Buckets
  reached from anywhere, once buckets have an address there, gives their own Caddy and nginx
  configuration; Databases and buckets says how apps reach them and lists each entry's address
  (from `system.doctor`; the demo says it starts nothing). A value set by an environment variable
  names it under the value. Change access is always offered, unless environment variables fix
  everything, and opens a two-step dialog: one question, "Where will you open evertap from?", as
  four rows with icons (`access-modes.ts` maps them) and the address each opens evertap at where
  known, then only what the chosen one needs (another address and buckets folded away for Devices
  on your network; where it runs, its address, and buckets folded away for Behind your own proxy
  or tunnel), then a step that confirms the new address that `system.settings.preview` returns and
  says what changes. A change that leaves this browser without its way in is not refused: the step
  says so, the button reads "Switch and open <host>", and `system.settings.update` returns a
  one-time sign-in link there that the page follows; where none can be made (This computer only,
  or no known address) the step says to change it back with `evertap setup`. A tunnel evertap runs
  goes through Cloudflare instead (`system.settings.tunnel`), in one component,
  `components/cloudflare-tunnel.tsx`: the tunnel's names and state, then the names for evertap
  and buckets (buckets' defaults to `s3.` in the same domain), or, after confirming another
  choice, whether Cloudflare keeps the tunnel; then a step that links to Cloudflare's consent page
  in a new tab and takes the code evertap.dev shows, and warns when buckets' name changes their
  `S3_PUBLIC_ENDPOINT`. A tunnel that does not connect within a minute is not switched to, and the
  step says why. The last step says how it went, unless the browser goes straight to its sign-in
  link at the new address with nothing to read. "Leave it there" switches at once and lists what
  stays in Cloudflare, each linked to the dashboard. Other success is silent.
- Search menu (Command in a dialog, `features/shell/components/search-menu.tsx`): opened by
  ⌘K / Ctrl+K or the sidebar's Search row. The row is drawn as a field (`panel` fill, `seam-2`
  edge, `print-3` label) so it reads as the place to type, with the key hint in a `Kbd` at its right
  (hidden on the rail and on touch); the rail keeps a plain icon. Empty, it lists the five most recently used resources and the pages (All
  resources, each engine, Clients, Doctor, Settings, New resource). Every typed word must appear in the resource name or engine
  label as written (no fuzzy matching: with hundreds of names it buries the real matches); results are grouped by engine, each row showing the engine mark, name, and engine
  label. Enter opens the resource page. The typed text resets on close, the shortcut toggles the
  menu, and it does not open while another dialog is up.
  Desktop width and heading transitions share a 200ms easing curve. The trigger stays
  anchored to the right edge, the footer keeps its height, and hidden links leave the tab order.
  Mobile sheets slide their full width off the left edge. Reduced motion removes these transitions.
- List, not cards: one-line rows (min 48px) divided by straight `--seam` rules, no borders around rows.
  Columns are aligned under one header: name 15/500 + chips · note 13px print-2 · size mono 12px
  right-aligned · last used 13px · ghost copy button + ⋯. The row copies the database URL or a
  bucket's `.env` values; the value itself is shown on the resource page. The name link covers the
  whole row, with the actions above it. Hover fills the row with panel-2, square like the
  rules; the "All N" / "Show all N" row under a group is square too. Columns use container queries because the sidebar
  changes the content width: under 576px the row stacks name over a size · last used line and keeps
  only ⋯ (copying stays in its menu). From 576px the note sits under the name and the copy button
  is icon-only; its label appears from 672px. Chips never start a line: from 576px they
  follow the name, and when stacked the size · last used line, so the text under the name starts
  flush with it. Protected is a pale green chip (`led-panel` / `led-print`, `protected-chip.tsx`),
  Temporary the same chip in amber (`amber-panel` / `amber-print`), both with 4px corners. In the list the temporary chip is shortened to "2 days left" ("<1 hour left" inside the last hour).
  All resources groups rows by engine under a panel-2 band (icon + name linking to the engine's page,
  count, +) that sits 4px above its first row; engines without resources are left out, and an empty
  box shows one sentence naming what to create. Each engine shows its five most recently used rows
  (`lib/recent-resources.ts`) so every engine stays near the top however long one of them is; the
  band count is the full total, and past five a 40px ghost row under the last one ("All 141
  PostgreSQL databases" + `ArrowRightIcon`, 13px print-2, aligned with the names) opens the engine's
  page, which lists everything in the same order. From nine rows up the engine's page puts the
  "Filter by name" field (`components/name-filter.tsx`, the one Clients uses) between the heading
  and the column header; while something is typed a mono 12px print-3 "10 of 41" sits beside it and
  no match shows "No name matches. Try part of the name." Beside the field a "Protected only" checkbox
  (Checkbox inside its Label, 32px tall, 44px on mobile) keeps the protected rows, counted
  the same way. It is a check mark, never a filled toggle button: beside the sort switch, where the
  fill marks the selected option, a lone filled button reads as either state; with nothing left it says to turn the toggle off. At the right, the
  shared format switch sorts Recently used / Least recently used. Least recently used puts never
  connected rows first (oldest creation first), then the oldest connection, the rule Clients uses,
  so the order reads straight down the Last used column. Only the field narrows: the checkbox and
  the switch never wrap, and under 608px of content width the three stack. The tools reset when the page changes
  engine. All resources has none: ⌘K searches across engines. An engine's page (`/?engine=xxx`) shows that engine's
  rows without a band, titles the page with the engine, labels the button "New database" or
  "New bucket", and links back to All resources. There is no scroll tracking and no URL hash.
- Connection field (`connection-url.tsx`): 36px, `--seam-2` border, panel bg, mono 14px (`text-sm`), secrets
  masked as ********, an eye button reveals it, ghost copy button whose label swaps to Copied (no toast).
  The connection panel is shared by the created dialog and resource page; `lib/resource-connections.ts` selects the
  resource's formats. Databases use URI · `.env` · `psql` / `mysql` / `redis-cli`; object storage uses
  Credentials · `.env` · AWS CLI. Credentials exposes endpoint, bucket, region, access key ID, and
  secret access key as individual copy fields; the secret key is masked. Row menus offer the same
  formats. Native radio inputs supply arrow-key navigation. Changing format resets reveal and copy feedback. Copy/reveal and
  format controls have 44px touch targets on mobile.
- Reachable from anywhere (`reachable-anywhere.tsx`, `resources.setReachableAnywhere`) is shown
  only in network and Cloudflare Tunnel modes, worded so it never reads as S3's public access
  ("Objects still need a signature"). Until buckets have an address of their own the switch is
  disabled (switching off stays possible) and the section says how to give one: in network mode
  the bucket Caddy and nginx configuration for `s3.example.com` beside it, in Cloudflare Tunnel
  mode the address the tunnel's route leads to, and an Open Settings link. Once on, it shows how
  to sign links with a second client on `S3_PUBLIC_ENDPOINT`, in JavaScript or Python; the
  connection panel adds the Public endpoint field and the `.env` line.
- Silent success: protect/unprotect and delete change what is on screen and show no toast.
  Only failures and hidden effects (copy from the menu) toast.
- The note on the resource page is edited in place (`note-editor.tsx`, `resources.setDescription`):
  clicking the note (a pencil beside it says so) or "Add note" turns it into a field; Enter or leaving it saves (empty clears the note),
  Escape cancels, and focus returns to the pencil. Success is silent; failures toast.
- Delete uses `features/resources/components/delete-resource-dialog.tsx`, shared by the row menu and the resource page; a protected resource must be
  re-typed by name. Deleting the currently displayed resource
  returns to its engine's page. The row menu is `features/resources/components/resource-actions.tsx`, with
  Keep and protection hooks in `lib/`.
- Temporary resources (created through the API for agents) show an amber countdown and a Keep action; humans never
  set an expiry, they only remove one.
- Creation is a two-step dialog over the current page, with no URL, so opening it never navigates.
  Generic "New resource" starts at Service. Engine + actions in the sidebar and list, and engine
  empty-state creation actions, start at Details with that engine selected. Back returns to Service
  without losing input and allows a different engine to be chosen. Success shows the connection panel in the same dialog
  directly from the creation response, without waiting for list refresh. Delete stays a confirmation dialog.
  A full-width Service / Details progress bar sits below the dialog heading. Two thin segments show
  the current step with a dark line; inactive lines stay light, including completed steps.
  `aria-current="step"` identifies the current step and completed steps show a check icon.
  The completed Service segment is a button that returns to service selection while preserving
  the form. It supports keyboard activation, shows hover/focus feedback, and is disabled during creation.
  A create still running after 5 seconds is likely the first of its version, which downloads and
  starts the service: a note above the buttons says the first one takes a few minutes. Past a
  minute the API answers "try again in a minute" while the download goes on.
- The Service step has one button per service, split into Databases (PostgreSQL, MySQL,
  Redis) and Object storage (Garage). Choosing one opens Details; there is no Continue and
  nothing is preselected. Every option is 72px tall, with three columns on desktop
  and two on mobile. A service missing from `system.status.engines` is disabled in place (mark
  dimmed, summary "Not available yet"), and an engine action for it opens at Service instead of
  Details. Until the status loads nothing is disabled; the API refuses what it cannot make. All
  four can be selected and created in the demo. Switching back preserves
  the form values and marks (`aria-pressed`) and focuses the service chosen last. Every form takes a name and note; object storage uses the name for its bucket. Databases add Version: "Latest (18)" is
  selected, and beside it the other versions are one step away, named when there is one ("8.4
  LTS") or "Other versions" with a mono select (next newest first) when there are more. MySQL
  versions carry "LTS"; PostgreSQL and Redis have no LTS line, so none is marked.
- Only PostgreSQL shows extensions. They are picked by search (multi-select combobox with chips)
  from the API's available-extension list, never a checklist embedded in the UI. The memory store
  provides samples; the real driver will query the instance. Failed loading offers Retry or
  creation without extensions.
- Clicking a resource's name, or choosing it in the search menu, opens `/resources/$id`: connection,
  for a bucket the Reachable from anywhere switch, details, Keep when temporary, protection switch,
  delete. It is a page of its own at every width;
  the list is not repeated beside it. A back link names
  the engine and returns to its page. The list stays the fast path through each row's copy button.
- Clients (`features/clients`): `/clients` lists paired CLIs and API keys under kind bands with
  the resource list's row language; rows are not links and the only row action is Revoke…, in a ⋯ menu
  shown on row hover or focus (always on touch), that opens an alert dialog naming when the client was
  added, last used, and from which address (CLI names repeat). Rows show the last call's IP address
  (`lastUsedIp`): a column at `@3xl`, part of the "Last used … from …" line when narrow. The
  page manages; adding lives elsewhere: the header's Add a device link and the Browsers and CLI
  bands' + go to `/device`,
  New API key and the API keys band's + open the dialog. Each kind shows five rows in the chosen
  order, so many CLIs never push the API keys off the screen; past five, the same 40px ghost row
  as the resource list toggles "Show all 76" / "Show fewer" in place (caret down / up). A typed
  name shows every match. From nine clients up a name filter and a
  Newest / Least recently used switch appear. `/device` (Add a device) takes any code, a new
  browser's or `evertap login`'s: the code field first, then "Pairing a CLI?" with the command. It
  is never a list of pending requests; `/device?code=…` titles the request by kind (Sign in a browser / Pair a CLI): compare
  the code, Approve or Deny. A rejected code falls back to the code field with the API's message,
  which clears once typing starts. A new API key is shown once, masked, as an `.env` line.
  Approving, creating a key, and revoking stay UI-only.
- Data browser (`features/data`, route `routes/resources.$id_.data.tsx`): `/resources/$id/data` is
  its own page, not a panel of the resource page (the `$id_` file name keeps it out of that
  route's layout); the back link names the resource and returns to it, the sidebar keeps the
  engine row active. The route sets `staticData.wide`, and `AppShell` drops the `max-w-4xl`
  column for it (banners included); every other page keeps the column. The resource page's Data
  section links here for PostgreSQL / MySQL / Redis, and says in the demo that browsing needs
  evertap running with Docker. Where the choice lives: the URL (`?schema=&table=`, `?sql=true`,
  `?key=`) so Back and reload return to it; page, sort, filters, and selection are state in the
  table view and reset with the table. The SQL text and last result live in the browser so moving
  to a table and back keeps them. The page is titled Data; under it the shared format switch
  picks Tables or SQL console, so the console is never mistaken for a table. The console takes the
  full width and keeps the chosen table in the URL, so switching back shows it again; its
  placeholder is a SELECT on that table (CREATE TABLE when there is none), marked "For example:".
  From `@4xl` the table list sits beside the table, sticks to the top, scrolls on its own, and
  gets a "Filter by name" field from nine tables. Narrower, the list is one 44px button naming the
  chosen table (`table-picker.tsx`) that opens a Command dialog to find another by part of its
  name, so however many tables there are, the rows start right under it; the table's own heading
  is then screen-reader only. Row edits are staged in the table view (see Staged edits).
  Grid (`components/rows-grid.tsx`): an ARIA grid with one Tab stop — arrow keys, Home and End
  move the focused cell (inset Signal ring); Enter / F2 or a double click edits; Space on the
  checkbox cell selects the row (on a new or deleted row it undoes it). Header sort buttons, the
  column resize handles, and the select-all checkbox are ordinary Tab stops. The editor over a
  cell is a growing textarea (values may hold line breaks): Enter keeps the value, Shift+Enter
  breaks the line, Escape cancels, leaving it keeps a change and cancels an unchanged one, Set
  NULL for nullable columns. Only the first ending counts. An emptied NULL or Default cell stays as
  it was. The editor follows its row by primary key, not position, and closes if a refetch takes
  that row off the page.
  Column widths: each column fits its content (header or values) up to 320px and never stretches
  to fill the pane. Dragging a header's right edge fixes every width (saved per table in the
  browser); double-clicking it returns to fitted widths. A cut header name or type ends in "…",
  and hovering or focusing that header shows both in full in a tooltip; uncut headers show none.
  Staged edits (`row-changes.ts`, state in `table-view.tsx`): nothing is written while editing,
  like a settings page that asks before leaving. Edits are keyed by the row's primary key and the
  column name, so they survive paging, sorting, and filtering, and edits to rows off the page
  still count and save. Editing a cell again replaces its staged value; typing the original back
  unstages it. Edited cells and new rows take Amber Surface with an sr-only "(unsaved)"; "Delete N
  rows" marks the selection (struck through in Ink Subtle, an undo arrow in the checkbox cell) and
  drops those rows' edits — the Save step is the confirmation, so there is no dialog. Add row puts
  an empty row at the top of every page and opens the editor on its first column without a default,
  rather than a dialog: the grid is already the place to type, and columns left alone show a
  Default tag and are left out of the insert. The × on a new row drops it. While anything is
  staged a bar sticks to the bottom of the table area (a region labelled "Unsaved changes"):
  the count by kind, Discard (no confirm, like Discord's Reset), and Save changes (⌘S / Ctrl S,
  anywhere on the page, also from an open editor, whose text is staged first). Saving sends one
  `data.applyChanges` (one transaction: all or nothing) and locks editing; success refetches every
  `data.*` query, then clears the staging, silently. A failure keeps everything staged and shows
  the API's message in the bar (`role="alert"`); the next change clears it. More than 500 rows of
  one kind is refused in the bar before sending. Switching tables, the console, Back, or any link
  away asks "Discard N unsaved changes?" (TanStack Router `useBlocker` with its resolver, Keep
  editing / Discard changes); closing the tab gets the browser's `beforeunload` prompt. Escape in
  the grid never discards. The SQL console and Redis keep their own immediate / Save behaviour. Rows are identified by
  their primary-key values; views and tables without one are read-only with a line saying what to
  do (edit the underlying tables, add a primary key, or use the console). Changing page, sort,
  or filters drops the selection so Delete never marks rows out of sight; a save that empties the
  last page shows the page before it. Filters are drafts until
  Apply / Enter, so half-typed values never run; a failed read keeps the filter bar's columns.
  Paging keeps the previous page on screen at 60% opacity while the next loads.
  Console (`components/sql-console.tsx`): ⌘/Ctrl+Enter runs from the textarea; results replace
  each other; a success invalidates every `data.*` query because a statement can change anything.
  Engine errors are shown as the engine wrote them (the one exception to "errors say the next
  action"), under one line saying to fix the statement and run it again. The console is
  read-only by default: an "Allow writes" switch beside Run (off on every visit) lets statements
  change data, and the line under them turns amber to say so. A refused change shows
  `READ_ONLY_REFUSED` (`rules.ts`) on an amber rule, without the fix-it line; flipping the switch
  clears it.
  Redis (`components/key-browser.tsx`, `key-detail.tsx`): the pattern applies on Search / Enter;
  SCAN pages append with Load more and are de-duplicated; an empty page that is not the end says
  to load more. A key's value is edited as a draft (`redis-draft.ts`: scores stay text until
  saved; duplicates, bad scores, and empty collections — which Redis would delete — block Save
  with a sentence). Save writes the value only when it changed (`writeKey` replaces value and
  expiry together; an untouched expiry keeps counting down from when it was read instead of
  restarting); an expiry-only change calls `expireKey`, which never rewrites the value. Values
  the editor cannot hold safely (`value` null: other types, non-UTF-8 text, very long strings,
  infinite scores) and values cut at `REDIS_VALUE_MAX` are read-only with one line saying to use a
  Redis client; their expiry can still change. A fresh read re-seeds the editor unless it has
  unsaved changes; saves refresh that key's read, and deleting drops it. New key writes with
  `createOnly`, so an existing name is refused by the API and its message shows in the dialog. On a
  narrow screen choosing a key scrolls its value into view.
  Loading shows skeleton lines in place, failures show the message and Try again in place
  (`components/load-error.tsx`), and data queries do not toast (`lib/orpc.ts`). Mutations toast
  failures only, except Save changes, whose failure stays in its bar; the grid, list, or dialog
  changing is the success feedback.
- Icons: Phosphor for UI, svgl-react for database marks, and the vendored official Garage mark
  for object storage (sources and licenses in `apps/web/public/brands/README.md`). Errors say the next action, not the
  cause. Never the words container / server / image / port.
  Back navigation uses `ArrowLeftIcon`, never a text arrow.
