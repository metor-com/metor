# Design sketch: several bots' computers in one app

Status: **implemented 2026-09-07** (overview, head of the bot list, rename, probe, badge sum,
notifications with the computer id; the desktop app additionally keeps its own event stream per
computer, see the end) · related: ADR-0012
(sign-in by device pairing), ADR-0015 (native clients: "keep several gateways side by side"),
ADR-0017 (push relay; `?c=<id>` names the sending computer), BACKLOG "phone access to a local
computer away from home".

## Starting point

A user with a bots' computer on their Mac and another one on a server has both connected in the
desktop app and in the phone app, but can only ever look at one of them:

- The interface is bound to **one computer per page load**: `frontend/src/lib/base.js` knows one
  origin, `api.js` one base path, `events.js` one event stream. The session token is added by the
  native layer for that one computer (desktop: the main process, phone: the bridge).
- The **desktop app** shows one computer per window and switches with `use(id)`, which reloads the
  window with the other computer's interface. The only ways to get there are the *Computers* menu
  and the tray – nothing in the interface itself says which computer a window shows.
- The **phone app** has the same `use(id)`, but the list of known computers lives only on the
  connect screen, which appears when the app is signed out of a computer or it does not answer.
  Signed in and connected there is no way to switch at all.
- Unread counts and the **app icon's badge** are per computer: the bridge sets the badge from the
  bot list of the computer it is connected to, and every push carries the sending computer's
  total. With two computers the icon shows whichever computer spoke last.
- A tap on a **notification** opens the bot by name on the computer the app currently shows
  (`openBot(bot)`), although the push names its computer (`?c=<id>` on the subscription's
  endpoint, passed on by the relay). A push from the other computer opens the wrong bot or none.

## Options considered

| Option | For | Against |
|---|---|---|
| A switch button | cheap, `use(id)` exists | a mode: which computer am I on? invisible; nothing says what is new elsewhere; every push from the other computer forces a switch |
| One list, grouped by computer with headings | everything at once, the computer's state sits in its heading | two long groups: the newest bots of the scrolled-out group are below the fold; needs an interface that talks to all computers at once |
| One flat list by latest activity with a computer tag per row | the newest entry is always on top, no interaction; the "all inboxes" pattern | needs the same multi-computer interface: one event stream and one token per computer, the bot identity becomes computer + name everywhere |
| **The mailbox pattern**: an overview of the computers with badges, a tap opens that computer's bot list, back leads up to the overview | the state is visible (computer name and back chevron in the list's head), the badges answer "anything new elsewhere?", the overview is the natural home of connect / forget / start / stop; fits one computer per page load | one level more on the phone; a switch is a reload today; the badges need numbers from computers that are not loaded |

Decision of this sketch: **the mailbox pattern.** It removes both weaknesses of the button, costs
no rewrite, and does not close the door to the flat list – "All bots" can become the first entry
of the overview one day, exactly like "All inboxes" in a mail app, while the overview stays.

## The design

### The overview "Computers"

Shown only when two or more computers are known to the app. One row per computer:

- **name** – as the app names it today (`Bots' computer on this Mac`, otherwise the host name);
  a *Rename* in the row's menu lets the user call it "office" or "home" (stored in the app's own
  store, never on the computer);
- **state** – nothing while it runs; `does not answer` when the app cannot reach it; for the
  local computer `stopped` with a *Start* button (the host command through the app, as on the
  connect screen), and *Stop* in the row's menu;
- **badge** – the number of unread replies across that computer's bots, the same number the bot
  list shows;
- *Forget* in the row's menu (signs the app out there, as on the connect screen).

Below the rows: *Connect a bots' computer…* (the connect screen's remote step; on a Mac also its
local step). The overview therefore replaces the connect screen's lists of known computers; the
connect screen keeps only the two ways in (local, remote) and its error states.

### Navigation

- **Start where you left off.** The app opens with the bot list of the computer used last, as
  today, never with the overview – otherwise every start costs one tap more. A tap on a
  notification opens the bot on the computer the push came from (see below).
- **Head of the bot list.** With two or more computers the wordmark makes room for a back chevron
  and the computer's name; the ⋮ menu and the + for a new bot stay. With one computer the head is
  unchanged. The wordmark moves to the overview's head.
- **Up and down.** The chevron opens the overview (`#/computers`, so the back gesture on a phone
  returns to the list); a tap on a computer row calls `use(id)`, which loads that computer's
  interface – a fresh page with its own history, the bot list at the top. On the desktop the
  overview replaces the content of the sidebar; the chat area keeps showing the selected bot.
- **The desktop menu and tray** keep their entries (*Connect…*, the local computer's *Set up /
  Start / Stop*, one radio entry per computer). A second window for a second computer stays
  possible; the overview does not need it.
- **Browser and PWA:** nothing changes – a browser is served by one computer and knows no other.

### Switching is a reload

`use(id)` reloads the interface today. Locally that is imperceptible, for a remote computer it is
about a second. This sketch accepts that; a warm switch (the interface holds both connections and
swaps the origin) is a later step, taken only if the reload turns out to annoy. Acceptance:
overview → tap → the other computer's bot list within two seconds on a phone in a mobile network.

### Numbers from computers that are not loaded

The native layer holds the session of every computer, so it can ask each one for its bot list
(`GET /bots/api/agents`, which carries `unread` per bot) and sum the counts – the interface never
gets another computer's token. `gateways()` in the preload API and the bridge grows by two fields
per computer: `unread` (the last known total, `null` if unknown) and `reachable`. The app refreshes
them when the overview opens and whenever a push arrives (`badge` in the payload, `c` on the
endpoint). No new gateway endpoint.

**The app icon's badge becomes the sum.** Each computer's last known total is kept natively (iOS:
the keychain group the app shares with its notification service extension; Android: the wrapped
preferences), keyed by the computer id; the icon shows the sum. The extension and the messaging
service set `content.badge` / the notification badge from that sum, not from the payload's
number. The bridge's `badgeFromAgents` writes the current computer's number into the same store.

### Notifications open the right computer

The native `opened` event hands the bridge the computer id along with the bot name (the id is on
the endpoint the push arrived through). If it is not the current computer, the bridge switches
(`use(id)`) and the interface opens the bot after the reload (`pendingBot` as today, keyed by
computer). The desktop app does the same for a click on a notification: the window that shows
that computer wins, otherwise the focused window switches. The Approve / Deny actions already
address the right computer (`MetorPush.setComputer` per registration) and do not change.

## Where the code goes

- `frontend/src/components/Computers.svelte` (new): the overview, rendered by `App.svelte` instead
  of the sidebar's list when the hash is `#/computers`; `Sidebar.svelte`: the head with chevron
  and name when `app.gateways()` has two or more entries.
- `frontend/src/components/Connect.svelte`: drop the lists of known computers (they move to the
  overview), keep the two steps and the error states.
- `client/desktop/src/main.mjs` and `preload.cjs`: `gateways()` with `unread` and `reachable`, a
  `metor:rename`, the notification click with the computer id.
- `client/mobile/src/bridge.js`: the same fields, the per-computer badge store, `opened` with
  the computer id; `MetorPushPlugin` (iOS and Android) and the iOS extension: the badge sum.
- The gateway: no change.

## Later, not part of this

- **"All bots"** as the first entry of the overview: one flat list across computers, sorted by
  latest activity, a small computer tag per row. Needs the interface to talk to every computer at
  once (one event stream and one token per computer, the bot identity computer + name in the
  hash, the chat, files, screen and terminal; "New bot" and Settings with a computer context).
  The overview stays as the management page; the *Sort bots by latest activity* setting already
  describes the order such a list would have.
- A warm switch without reload (see above).

## Open questions

- Whether the overview should also be reachable from the ⋮ menu with a single computer, as the
  place to connect a second one – or whether *Connect a bots' computer…* in that menu is enough
  until the second computer exists (the sketch assumes the latter).
- How the desktop app treats a second window once the overview exists: keep "one computer per
  window" as is, or let every window start on the overview.

## What was built (2026-09-07)

As sketched, with two additions. The desktop app has no push, so a computer no window shows would
have stayed silent: the main process now keeps one event stream per signed-in computer (`agents`
for the counts, `notify` for the computers no window shows), which also keeps the overview's badges
live and names the computer in the notification. And the ⋮ menu of the bot list offers *Connect a
bots' computer…* in both apps, so a phone can add a second computer at all. Verified with the
desktop app against a local computer and a server: the overview with both counts, the switch, a
notification from the computer not shown. The native badge sum and the tap on a push from another
computer are built for iOS and Android; the real-iPhone check is still open. The open question on
a second desktop window was answered by leaving it as it was (one computer per window).

After five reviews (2026-09-07/08) the shape is: in the apps the head of the bot list always names
the computer shown, centred next to a back arrow that leads to the **overview** – the root screen,
no arrow of its own: one row per computer with its unread count (a tap switches; the one shown
returns to its list without reloading), below them *Add new computer* (the connect screen), and a
⋮ menu at the top that opens the Settings. Inside a computer the ⋮ menu holds only what concerns
it: *Rename computer…* and *Remove computer*. The round + for a new bot floats at the bottom right
of the list. The connect screen keeps a list of the known computers, because the overview cannot
be reached from there. Tried and dropped on the way: an overview only with two or more computers,
a "New bot" row below the list, floating buttons at the bottom left, a computers menu instead of
the overview, and a "Manage computers" dialog with ordering.

**Movement (2026-09-08).** The views slide as on a phone (`frontend/src/lib/transition.js`, a Svelte
transition on transform and opacity only, reduced motion honoured): forward the arriving view comes
in from the right over the leaving one, which moves a third to the left and dims; back the reverse.
Opening another computer still reloads the interface, but its bot list – known from the overview's
probe – slides in first and travels along in sessionStorage, so the new page shows it at first
paint, in the order the settings ask for, and with the bots' pictures: the list that slides in
names its computer, so the pictures come from there (the bridge adds that computer's token; the
desktop's main process already does).

**The warm switch (2026-09-08).** Opening another computer no longer reloads the interface: the
app's `use(id)` changes its token and cookie (and registers push there) and answers with the
computer's state; `base.js` keeps the origin as a live binding and the gateway as a store, the
API reads the origin per request, and `switchComputer` in `session.js` starts the stores over,
moves the event stream and fills the sidebar with the list the overview already knows. The shell
follows the gateway store, so a computer that is signed out or silent lands on the connect
screen. A notification from another computer switches the same way before it opens the bot.
The desktop's `metor:use` marks the window instead of loading it; a window that shows the
computer already comes to the front and the answer is null. What still reloads: sign-out,
forgetting the computer shown, and a notification click that moves a desktop window.

