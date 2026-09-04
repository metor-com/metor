# Getting started with metor

This guide walks through the web interface. It assumes a running installation (see
[INSTALL.md](../INSTALL.md) for servers or the quickstart in the [README](../README.md) for a local
box) and that you can open the interface - locally at `http://127.0.0.1:6010/bots/`, on a server
at `https://<your-domain>/bots/` after opening your setup link (section 1).

<!-- screenshot: overview with sidebar, chat and computer panel side by side -->

## 1. Sign in and devices

The interface has no passwords. The first browser gets in with a **setup link** that the installer
prints at the end (and that `metor auth link` inside the box prints again at any time, valid for
24 hours, single use). Every further phone or computer is linked from a device that is already
signed in: open the **⋮ menu** at the top of the bot list → **Settings**, section **Devices**, click **Link a device**, and on the new
device either scan the QR code with the camera or open the interface and type the pairing code on
the sign-in page. Links and codes are valid for two minutes.

The **Devices** tab also lists every signed-in browser (name, last seen) - remove one to sign it out, or
sign out the device you are on. Lost all devices? `metor auth link` over SSH mints a new setup link.

**Settings** has three more sections. **Connectors** are MCP servers every bot can use: **Add →
From the directory** offers well-known ones (a shared memory, documentation lookups, DeepWiki,
GitHub, search APIs) and pre-fills the form, **Custom connector** takes any server by command or
URL with its environment variables or headers. Bots use a connector on their own, like the browser;
switch on **Ask before each use** to get an approval card for every call instead. Keys and tokens
are stored inside the computer.
A connector reaches a bot when the bot starts - after a change, the button **Restart running
bots** does that for you. **Appearance** (text size; a compact bot list with one line per bot; whether the Claude quota bar
shows always, never or only from a chosen usage) and
**Behaviour** (sort the bot list by latest activity, newest chat on top like a messenger; which
view a bot opens with on a wide screen) are remembered per device.

**On the phone or tablet** the interface installs as an app. Android: the browser's menu or
**Settings → Devices → Install metor as an app**. iPhone and iPad: Share → **Add to Home Screen**, open metor
from the home screen and sign in there once with a pairing code (the home-screen app has its own
cookie jar). Then turn on **Settings → Devices → Notifications on this device**: you get a push when a bot
needs an approval, has finished a reply or stopped unexpectedly - never on the device that is
looking at that chat. The box sends these itself, no third-party service is involved; the
interface must be reached over HTTPS for this.

<!-- screenshot: Settings → Devices with the QR code -->

## 2. Create your first bot

Click the round **+** at the top right of the bot list.

- **Name** - free text, for example `Scout` or `Fußball-Späher 2`. The dialog shows the **id** it
  derives from the name (`fussball-spaeher-2`: lower case, umlauts as `ae`/`oe`/`ue`, everything
  else a hyphen) - that id is the directory name, part of every link and the address other bots
  use; change it there if you want a different one. The name is what you see everywhere else.
- **Role** - what this bot is for. A good role is one or two sentences about the job and the way of
  working, not a task list: "Researches topics on the web and writes short, sourced summaries as
  Markdown files. Asks before spending more than an hour on something." The role becomes the top of
  the bot's standing instructions; concrete tasks come later in the chat.
- **Runtime** and **Model** - the harness that runs the bot and the model it uses. Claude Code
  offers Opus, Sonnet (default) and Haiku; Codex offers the current GPT models. Both can be mixed
  freely across bots; a bot's runtime and model cannot be changed in the interface afterwards
  (create a new bot instead).
- If the chosen runtime is **not set up** yet, the dialog shows an amber box with a **Sign in**
  button. Claude Code: open the link, sign in with your subscription, then paste the code the page
  shows at the end into the box and confirm. Codex: you get a link and a one-time code, open the
  link, enter the code, confirm - the box waits and turns green when the login has arrived. Links
  and codes are valid for 15 minutes. Runtime logins are per box, not per bot.

**Create** sets up the desktop and the session; that takes up to a minute. The bot appears in the
sidebar like a chat in a messenger: an avatar with a status dot (green = ready, amber = working,
red = waiting for approval, grey = stopped), the time of the last message, a one-line preview of
it and, once the bot has written something you have not looked at yet, a badge with the count.

<!-- screenshot: new bot dialog with the Codex setup wizard -->

## 3. Chat

Select the bot and type a message into the box at the bottom. **Enter** sends, **Shift+Enter** adds
a line break.

- **Streaming**: the answer types in live in a "typing" bubble and settles into a normal message
  when the turn is complete. Markdown is rendered.
- **Tool lines**: grey lines with a gear icon show what the bot is doing (reading a file, running a
  command, opening a page). Click a line to expand the full command and its result; click again to
  collapse it.
- **Approval cards**: when the runtime asks for permission - typically for actions with external
  effect - an amber card titled "Approval" appears with the tool, the reason and the exact input.
  Choose **Allow** or **Deny**. The card stays in the history with the decision. While a card is
  open the bot's status dot is red, and with notifications turned on (Settings → Devices) your phone
  gets a push.
  Approval cards come from Claude Code bots; Codex bots currently run without approval prompts
  inside the box.
- **Stop**: while the bot is working, a red stop button sits in the header. It interrupts the
  current turn; the bot keeps its context and you can send the next message right away.
- **Message status**: your own messages carry ticks like in a messenger - one tick while the
  message is on its way, two grey ticks once the bot's session has taken it, two green ticks once
  the bot has answered; "failed" with an error line when the bot is not running.

Messages triggered by a routine (see below) appear in the history as grey bubbles marked "Routine".

## 4. Attachments

You can hand files to the bot in three ways: the **paperclip** button next to the input opens a
file dialog; **paste** (Cmd/Ctrl+V) drops a screenshot or a file from the clipboard; **drag and
drop** anywhere onto the chat works too. Every attachment shows as a chip above the input with a
thumbnail (images) or a file icon, the size, and a small **x** to remove it again. Limits: 25 MB per
file, 10 files per message. Pasted screenshots get a numbered name.

On send, the files are stored under `uploads/` in the bot's directory and the bot receives one
`[Attachment: ...]` line per file with the full path. It reads images itself with its own tools,
so attachments work the same for every runtime. In the history your attachments appear as
thumbnails or file chips inside your message; click to open them.

## 5. Files from the bot

Whenever the bot mentions a file it created - a report, an export, a screenshot - the chat offers
it as a **file card** inside the bot's message: images show a preview, other files a name, size and
download. Bots do this deliberately with a `[File: path]` marker in their reply, and file paths
mentioned in plain text are picked up automatically as well. To browse everything the bot has,
open the **Files** tab in the computer panel (next section).

## 6. The computer panel

The computer button in the header (a small monitor) shows the bot's computer next to the chat;
drag the divider between the two to give either more room (the share is remembered per device).
On a phone the computer replaces the chat while it is shown. The computer panel has three sub-tabs:

- **Screen** - the bot's desktop, streamed via noVNC. You see the browser window the bot drives and
  can take over with mouse and keyboard at any time: log into a site, solve a captcha, approve a
  two-factor prompt, close a pop-up. Logins persist in the bot's browser profile, so one manual
  login usually lasts. When a bot gets stuck it says so in the chat and waits for you. Right after
  creating a bot the panel may show "Loading computer" or "Waiting for the computer" for a few
  seconds until the desktop is up.
- **Terminal** - a real shell in the bot's directory (copy and paste supported). Use it to look
  around, run a command yourself, or fix something the bot could not. The shell lives as long as
  the tab is open; a page reload starts a fresh one.
- **Files** - a file browser rooted at the bot's directory: click folders to descend, use the
  breadcrumb to go back up, click a file to open or download it. Hidden (dot) directories are not
  shown.

<!-- screenshot: computer panel with the Screen tab and a browser window -->

## 7. Routines

A routine is a recurring task the bot runs on its own. You do not fill in a form - you tell the bot
in the chat: "Every weekday at 7:00, check the three feeds in `sources.md` and post a five-line
digest." The bot creates the schedule itself and confirms it. Times are in the box's local time zone
(Europe/Berlin by default, see INSTALL.md).

The routines button in the header (a calendar with a clock) shows the bot's routines next to the
chat, one card each in plain words: when it runs ("Weekdays at 07:00"), the next and the last run,
whether it is active or paused and why, and the task the bot receives. Below the cards the recent
runs are listed. The panel is read-only: routines are changed the same way they are created - ask
the bot to move the time, change the task, pause or resume it, or delete it. Each run arrives in
the chat as a grey "Routine" message followed by the bot's work.

**Auto-pause**: a routine that has run 20 times without you sending the bot any message is paused
automatically and marked "paused" in the panel; the bot leaves a note in the chat. Just tell the
bot to resume it. The threshold is configurable per installation (`METOR_ROUTINE_GUARD`, `0`
disables the guard). A run that was missed while the box was down is caught up once after the
restart.

## 8. Runtimes and models

Each bot runs on one **runtime** - Claude Code or Codex - and one model, chosen at creation. The
header of a bot shows both as a small badge on desktop widths.

- **Claude Code** bots use your Claude subscription. The sidebar shows the subscription's quota
  ("Claude quota", five-hour window and, where available, the weekly window) as a bar; all Claude
  bots share it. When it is exhausted, Claude bots wait until the window resets.
- **Codex** bots use your ChatGPT subscription. Their quota is separate and not shown in the
  interface yet. Codex bots can chat, use shell and files, drive their browser, run routines and
  send files; assigning tasks to other bots is not available for Codex bots yet.

Runtime logins live in the box (one per runtime, shared by all bots of that runtime) and survive
restarts and updates. If a runtime's login expires, only that runtime's bots stop.

## 9. Mobile

On a phone the interface follows the messenger pattern: the sidebar is the bot list, tapping a bot
opens its view, the **back arrow** at the top left (or the browser's back gesture) returns to the
list. The computer button in the header switches between the chat and the computer. Routines
and the bot actions (Pause, Start, Remove) are in the **more** menu (the three dots). The screen
tab works with touch, but for real intervention a desktop browser is more comfortable.

## 10. The desktop app

metor is also an app for macOS, Windows and Linux (`client/desktop`, built from the repository or
taken from a release). It shows the same interface, and adds what a browser tab cannot:
notifications for approvals, finished replies and unexpected stops while the app runs, a tray
icon, several computers side by side (menu **Computer**), and screen sharing for the bots.

On first start the app asks for a computer: paste the **setup link** (from the installer or
`metor auth link` inside the box - the address comes with it), or enter the address plus a
**pairing code** from *Settings → Devices → Link a device* on a device that is already signed in.
The app then appears under Devices as "metor app on Mac/Windows/Linux"; removing it there signs
the app out, and the app's connect screen offers the computer again.

## 11. Managing bots

With a bot selected, the header (or the more menu on phones) offers:

- **Pause** - stops the bot's runtime session and desktop. The bot keeps everything: directory,
  history, routines, session context. Routines do not fire while a bot is paused.
- **Start** - starts a paused or stopped bot again; the session resumes with its context.
- **Remove** - after a confirmation, stops the bot and **deletes its directory**, including the
  chat history, uploads, files it created and its routines. This cannot be undone; download what
  you need first. (The command line offers `metor bot rm <name> --keep-files` to remove the bot but
  keep the directory.)

Bots restart automatically when the box restarts, unless they were paused.

## 12. Troubleshooting

- **A bot shows "stopped" and messages fail.** Most often the runtime login has expired. Sign in
  again: open "New bot", pick the runtime and click **Sign in** (terminal alternative for Claude
  Code: `docker compose exec box claude auth login`, or `docker exec -it metor-box claude auth login`
  on a local box). Then press **Start** on the bot. The box's supervisor log
  (`docker compose logs box`) shows the reason if it was something else.
- **The screen says "connecting" or "Waiting for the computer" for a long time.** Reload the page.
  Right after creation the desktop needs a few seconds; after a box restart the desktops come up
  one by one. If it never connects behind your own reverse proxy, check that the WebSocket paths
  pass through as described in INSTALL.md.
- **The bot does not answer and the sidebar quota bar is full.** The Claude quota for the current
  window is used up (the bar turns red above 80 percent); all Claude bots share it. Wait for the
  window to reset or use a Codex bot in the meantime.
- **A routine stopped running.** Open the routines panel: if it is marked "paused", the auto-pause
  kicked in - ask the bot to resume it.
- **An attachment is rejected.** Check the limits (25 MB per file, 10 per message).
- **A bot is stuck in the browser** (login, two-factor, captcha). Open the Screen tab, do the step
  yourself, then tell the bot in the chat to continue.
