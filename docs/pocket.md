# The office in your pocket

cubefarm works from a phone: **pocket mode** is the office as a 2D app, it installs on your home screen, and the
office tells you when something needs you, on your devices or in Discord, Slack, Telegram or ntfy.

## Pocket mode

On a narrow or touch screen the office opens in pocket mode by itself. On a computer, pick **📱 Pocket mode** on the
start screen. Each device remembers what you last chose; `?pocket=1` or `?pocket=0` in the address decides for one
visit. Five tabs, at the bottom:

| Tab | What's there |
| --- | --- |
| **Company** | Each floor's pipeline: 🔨 building, 🔍 in QA, 🔧 being fixed, ✅ ready to merge, ⚠️ needs you. Banners when Claude's usage pauses or paces the office, or when it's updating. |
| **Chat** | The CEO's phone thread, with ▶ to replay messages read aloud. |
| **Kanban** | Each floor's board, one column under the other: assign, send to QA, merge, close, file issues. |
| **Team** | Everyone's status and what they're on, with **Message**, **■ Stop**, **↺ Clear desk**, assigning an issue (or a PR to test) and their terminal. |
| **Approvals** | Hires and let-gos waiting for you, stuck PRs (**Retry QA**, **Send back**, **Merge anyway**, **Close**) and passed PRs on floors without auto-merge. |

Pocket mode uses the same live connection and commands as the 3D office, and loads no 3D at all until you tap
**🏢 Open the 3D office** (Company tab, or ⚙️).

## Install it

The office is an installable web app: Chrome and Edge offer **Install** in the address bar (on Android: ⋮ → **Add
to Home screen**), and Safari on iPhone has **Share → Add to Home Screen**. Installing needs the office to be served
over HTTPS, or opened as `localhost` on its own PC (see [phone access](#reach-the-office-from-your-phone)).

The app's service worker caches only the app shell (the page, its scripts and styles, the icons) so it opens quickly.
It never caches the office's data: everything you see comes live from the office. Every office update gives the
worker a new version, which replaces the old one and its cache, so the app never runs stale code.

## Notifications

Open **⚙️ Settings → 🔔 Notifications** in the manager's console (or **⚙️** in pocket mode) and pick what you hear
about:

- a pull request needs you (stuck, and the CEO has handed it to you)
- a message from the CEO
- a hire or let-go waits for your decision
- someone has been stuck in an error for over 10 minutes
- Claude's usage limit pauses the office, or a usage warning paces it
- every merge (off unless you turn it on)

You get at most one notification of each kind a minute. Whatever else of that kind happens in the minute arrives
together as one summary ("🔀 9 more merges"), so a burst of merges is two notifications, not ten.

**Office address for links:** set it to the address your phone opens the office at (for example your Tailscale
Serve URL) and every chat message ends with it, so a tap takes you there.

Every channel has an **On** switch and a **Test** button. A demo office (`--demo`) sends nothing: it starts with
every chat app set up with fake addresses and prints what each would get in the server's log.

### Desktop notifications

Any browser with the office open in a background tab shows notifications, once you click **Allow in this
browser**. A tab you're looking at doesn't: the office chimes and shows the toast there anyway.

### Push to your phone (Web Push)

Push reaches a device even when the office isn't open on it. On each phone or PC, open the office over HTTPS (or as
`localhost` on the office's own PC), go to **⚙️ → Notifications** and tap **Push to this device**, then **Send test**.
On an iPhone (iOS 16.4 or later), add the office to the home screen first and turn push on from the installed app:
Safari only allows Web Push there.

The office signs its pushes with its own VAPID key pair, made the first time a device signs up and kept in
`<SWARM_HOME>/push.json` with the devices' subscriptions (owner-only file permissions). Messages are encrypted for
each device (RFC 8291) and go through the browser maker's push service (Google, Mozilla, Apple), which can't read
them. A device that unsubscribes, or whose browser data is cleared, is dropped the next time a push to it fails.

### Discord

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook**, pick the channel, **Copy Webhook URL**.
2. Paste it under **Discord** and **Save**, then **Test**.

### Slack

1. At [api.slack.com/apps](https://api.slack.com/apps), create an app (from scratch), turn on **Incoming Webhooks**,
   and **Add New Webhook to Workspace** for the channel you want.
2. Paste the `https://hooks.slack.com/services/…` URL under **Slack**, **Save** and **Test**.

### Telegram

1. Message [@BotFather](https://t.me/BotFather), send `/newbot` and follow it; it gives you the bot token
   (`123456789:AA…`).
2. Send your new bot any message (bots can't start a chat with you).
3. Find your chat id: open `https://api.telegram.org/bot<token>/getUpdates` in a browser and look for
   `"chat":{"id":…}`. Group ids start with `-100`.
4. Enter the token and chat id under **Telegram**, **Save** and **Test**.

### ntfy

[ntfy](https://ntfy.sh) pushes to its own phone app with no account. Anyone who knows a topic's name can read it, so
pick a long random one.

1. In the ntfy app, subscribe to a topic such as `cubefarm-7f3k9q2m`.
2. Enter `https://ntfy.sh/cubefarm-7f3k9q2m` (or your own ntfy server's topic URL) under **ntfy**. For a topic with
   access control, add its access token (`tk_…`). **Save** and **Test**.

### Where the secrets live

Webhook URLs, the Telegram token and the ntfy topic and token are kept in `<SWARM_HOME>/secrets.json`
(`~/.cubefarm/secrets.json` by default) next to the ElevenLabs key: owner-only file permissions, never in
`state.json`, never logged, never sent to a browser (the settings show the last 4 characters) and never given to
agents. **Remove** deletes them. A demo office keeps its own `demo-secrets.json` and `demo-push.json`.

## Reach the office from your phone

The office listens on `127.0.0.1` only, on purpose: it can start agents that run commands on your PC, so it must
never be open to your network or the internet as it is. It never changes that or opens ports itself. To use it from
your phone, put something that authenticates you in front of it:

- **Tailscale Serve (recommended).** Install [Tailscale](https://tailscale.com) on the office's PC and your phone,
  signed in to the same tailnet. On the PC run:

  ```
  tailscale serve --bg 4317
  ```

  It prints an address such as `https://office-pc.your-tailnet.ts.net`, with a real HTTPS certificate, reachable
  only from your own devices. Open it on your phone: pocket mode, installing and push all work. Put the same address
  in **Office address for links**. `tailscale serve reset` stops it. Don't use `tailscale funnel`, which publishes the
  office to the whole internet.
- **Cloudflare Tunnel with Cloudflare Access**, or another tunnel that makes you sign in before anything reaches the
  office, also works. A tunnel without its own sign-in is not safe.

Over plain `http://` on your LAN (say `http://192.168.1.20:4317`, which needs the office to listen there, which it
doesn't) browsers refuse service workers and push, so there's no install and no push: another reason to use HTTPS.
