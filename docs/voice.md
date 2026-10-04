# Voice messages

The office can read the CEO's phone messages aloud the moment they arrive, in a voice you pick, without opening the
phone. Two voices are on offer:

- **Browser:** your browser's own text-to-speech. Free, offline, robotic.
- **ElevenLabs:** natural voices from [ElevenLabs](https://elevenlabs.io), with your own API key. Costs a little per
  message (below).

Office notes (merges, errors, decisions) are spoken too only if you turn on **Speak office notes**.

Facts about ElevenLabs below were checked against its docs and pricing pages in October 2026.

## Getting an ElevenLabs key

1. Sign up at [elevenlabs.io](https://elevenlabs.io). Library voices, including the shortlist below, need a paid plan
   to be used through the API ("Voice Library voices are not available via the API to free tier users").
2. Open **Developers → API Keys** and create a key. If you restrict it, allow **Text to Speech** and **Voices (read)**.
   You can also give it a credit quota there, as a spending cap for the office.
3. Paste it into the office's voice settings. The office checks it with one call (listing one voice) before saving it.

Where the key lives: `<SWARM_HOME>/secrets.json` (`~/.cubefarm/secrets.json` by default), readable only by you where the
OS has file modes. It is never written to `state.json`, never sent to the browser (the settings show its last 4
characters), never logged and never given to agents. A demo office keeps its own `demo-secrets.json`. Clear the key in
the settings to delete it.

If ElevenLabs ever answers with 401 (the key was revoked or deleted), the office tells you once on the phone and stops
calling ElevenLabs until you enter a new key.

## Model and cost

The default model is **`eleven_flash_v2_5`** (Flash v2.5): ElevenLabs' lowest-latency model (~75 ms before network
time), 32 languages, and half the price per character of Multilingual v2. Other models you can set:

| Model | Why |
| --- | --- |
| `eleven_flash_v2_5` (default) | fastest and cheapest; plenty for short updates |
| `eleven_v4_turbo` | newer and more expressive, still real-time (~100 ms) |
| `eleven_multilingual_v2`, `eleven_v4` | highest quality; slower and pricier |

What a message costs: on ElevenLabs' API pricing, Flash costs about **$0.04 per 1,000 characters** (Multilingual v2
and v3: $0.08). A typical CEO update is 300–800 characters of speech once markdown, emoji and links are stripped,
so about **1–3 cents**; the office never speaks more than about 1,500 characters of one message (about 6 cents). On a
subscription plan the same text uses credits from your monthly allowance instead. Each message is synthesized once and
cached (`<SWARM_HOME>/voice/`, at most 200 clips or 7 days), so replaying it is free. The settings' **Test** button
speaks one short line (about 60 characters) and caches it too.

## Shortlisted voices

ElevenLabs' old Default voices (Rachel, Sarah, George, …) **expire on 31 December 2026**, and accounts created after
March 2026 never had them. The shortlist is therefore taken from the new voices ElevenLabs recommends as their
replacements, which stay usable for good. They're in the Voice Library and can be used by id without saving them; save
one to **My Voices** to see it on elevenlabs.io too. The office marks these `recommended` in the voice list and shows
them first, followed by the voices on your account.

| Voice | Id | Why it suits a calm, friendly CEO |
| --- | --- | --- |
| Talia: Warm Soft Guide | `OZ0L6eISlOejga3XjDFt` | gentle and warm; good news and bad news both land softly. The default. |
| Eddie: Helpful and Comforting | `l7kNoIfnJKPg7779LI2t` | reassuring, never pushy: right for "here's what's blocked and why". |
| Caleb: Trusted Guide | `AaOhDHYJ1XLZk74lXhdE` | steady and credible; sounds like someone who has the plan in hand. |
| Darian: Warm Grounded Storyteller | `gOupLcAkjEnguROwi4oS` | relaxed and grounded; makes a progress summary sound like a story. |
| Alicia: Polished Global Anchor | `BFd5oBc2DDna33pSi4Gf` | clear newsreader delivery; easy to follow over music or office noise. |
| Maisie: Friendly Casual Neighbor | `QtY3JBOUKEB5xzrRfOKc` | chatty and informal, for a startup that doesn't do corporate. |
| Wyatt: Seasoned Mentor | `FrS6cKLB1wg4WYgPa9GW` | older, calm and unhurried; a CEO who has seen it all. |
| Eldrin: Crisp British Baritone | `6WwXjDDEMyNmFG95zycZ` | deep and composed, with a British accent. |

They replace Sarah, Eric, Chris, Roger, Alice, Matilda, Bill and George respectively. Listen to them (the Test button,
or ElevenLabs' Voice Library) before you choose: tone matters more than the description.

## What gets read

Before speaking, a message is tidied for the ear (`shared/speech.ts`, used by both voices): markdown and emoji are
removed, `#123` becomes "number 123", a URL becomes "a link", and long messages are cut at a sentence end after about
1,500 characters.

## In the office

A message is spoken as it arrives, whether the phone is open or not, and also while the office tab is in the
background. Browsers only allow sound after your first click or key in the tab, so anything that arrived before that,
and anything already on the phone when the page loads, stays silent. Messages are read one at a time, in order; at
most 3 wait their turn and anything older than 2 minutes is skipped. With several office tabs open, only one reads
each message (the one you're looking at, if any).

The **Voice** slider in the sound settings (help, **H**) sets its level under the master volume, and **M** mutes it
like every other sound. Other office sounds dip by about 8 dB while a message is spoken. A 🔊 on the phone icon shows
it's speaking; click it to stop. If the clip can't be fetched (no key, ElevenLabs down), you hear the usual message
chirp instead. `window.__swarmVoice` lists the messages read aloud (`id`, `provider`, `start`, `end`, `volume`).

## API

| Route | What it does |
| --- | --- |
| `PUT /api/voice/key` `{ key }` | checks and saves the key; `""` removes it. 400 if ElevenLabs rejects it |
| `GET /api/voice/voices` | `[{ id, name, category, labels: { accent, gender, age, description, use_case }, previewUrl, recommended }]`, cached 10 minutes; 409 without a key |
| `GET /api/voice/messages/:id` | `audio/mpeg` for a CEO message (or an office note with Speak office notes on); 404 when the voice isn't ElevenLabs or there's no such message, 502 when ElevenLabs fails |
| `GET /api/voice/sample?voiceId=…` | the Test line in that voice (default: the chosen one) |

Settings travel in `settings.voice` (`PATCH /api/settings`): `{ provider: 'off' | 'browser' | 'elevenlabs', voiceId,
voiceName, model, speakOffice }`. The snapshot has `voiceKeySet` and `voiceKeyHint`, and a `voiceKey` event follows
every key change. One clip is made at a time (20 s timeout); requests for a clip that's being made share that call.

The demo office (`--demo`) fakes all of it with no network: any key except one containing "bad" is accepted, there are
three voices, and every message is a short generated chime (a WAV).
