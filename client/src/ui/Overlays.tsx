import { useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { SENSITIVITY_MAX, SENSITIVITY_MIN, useLookPrefs } from '../world/look';
import { CEO_ID } from '../../../shared/types';
import { AppViewer } from './AppViewer';
import { CardView } from './CardView';
import { Catalogue, DecorBoxPanel } from './Catalogue';
import { ElevatorPanel } from './ElevatorPanel';
import { KanbanView } from './KanbanView';
import { ManagerConsole } from './ManagerConsole';
import { Panel } from './Panel';
import { Phone } from './Phone';
import { TerminalView } from './TerminalView';
import { getAudioPrefs, setAudioPrefs, subscribeAudio } from './sfx';
import { SOUND_GROUPS, type SoundGroup } from './audioPrefs';
import type { DayMode } from '../world/sky/time';
import { setDayMode, useDayTime } from '../world/sky/useDayTime';
import { GRAPHICS_PRESETS, type GraphicsPreset } from '../world/gfx/quality';
import { effectiveTier, setGraphicsPreset, useGfx } from '../world/gfx/useGraphics';

export { closeOverlay, Panel } from './Panel';

const SOUND_GROUP_LABELS: Record<SoundGroup, string> = { steps: 'Footsteps', typing: 'Typing', toys: 'Toys', alerts: 'Alerts', music: 'Music', voice: 'Voice', outside: 'Outside', score: 'Soundtrack' };
const SOUND_GROUP_TITLES: Partial<Record<SoundGroup, string>> = {
  alerts: 'The phone, the elevator and work cues',
  music: "Each floor's jukebox",
  voice: 'Messages read aloud',
  outside: 'Wind, the city, birds and crickets, on the balconies',
  score: "Quiet music that follows the office's mood, when no jukebox is playing nearby",
};

/** Office volume, mute and a level per kind of sound; saved in this browser. */
export function SoundControls() {
  const prefs = useSyncExternalStore(subscribeAudio, getAudioPrefs);
  const { volume, muted, soundtrack } = prefs;
  return (
    <div className="sound-controls">
      <div className="row wrap sound">
        <label className="toggle">
          <input type="checkbox" checked={!muted} onChange={(e) => setAudioPrefs({ muted: !e.target.checked })} /> {muted ? '🔇' : '🔊'} Sound
        </label>
        <label className="toggle" title={SOUND_GROUP_TITLES.score}>
          <input type="checkbox" checked={soundtrack} onChange={(e) => setAudioPrefs({ soundtrack: e.target.checked })} /> 🎼 Soundtrack
        </label>
        <label className="sound-volume">
          <span className="muted small">Volume</span>
          <input type="range" min={0} max={100} step={5} value={volume} disabled={muted} aria-label="Volume" onChange={(e) => setAudioPrefs({ volume: Number(e.target.value) })} />
          <span className="small sound-pct">{volume}%</span>
        </label>
      </div>
      <div className="sound-groups" role="group" aria-label="Volume for each kind of sound">
        {SOUND_GROUPS.map((g) => (
          <label key={g} className="sound-volume" title={SOUND_GROUP_TITLES[g]}>
            <span className="muted small sound-group-name">{SOUND_GROUP_LABELS[g]}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={prefs[g]}
              disabled={muted || (g === 'score' && !soundtrack)}
              aria-label={`${SOUND_GROUP_LABELS[g]} volume`}
              aria-valuetext={`${prefs[g]}%`}
              onChange={(e) => setAudioPrefs({ [g]: Number(e.target.value) })}
            />
            <span className="small sound-pct">{prefs[g]}%</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function MouseSettings() {
  const { sensitivity, invertY, grabOnClose, set } = useLookPrefs();
  return (
    <div className="mouse-settings">
      <label className="mouse-sens">
        <span>Mouse sensitivity</span>
        <input type="range" min={SENSITIVITY_MIN} max={SENSITIVITY_MAX} step={0.05} value={sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
        <b>{sensitivity.toFixed(2)}×</b>
        {sensitivity !== 1 && (
          <button className="btn btn-ghost btn-small" onClick={() => set({ sensitivity: 1 })}>
            Reset
          </button>
        )}
      </label>
      <label className="toggle">
        <input type="checkbox" checked={invertY} onChange={(e) => set({ invertY: e.target.checked })} /> Invert Y (push the mouse forward to look down)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={grabOnClose} onChange={(e) => set({ grabOnClose: e.target.checked })} /> Grab the mouse when panels close
      </label>
    </div>
  );
}

const DAY_MODE_LABELS: Record<DayMode, string> = { cycle: '30-minute day', clock: 'Follow my clock', day: 'Always day' };

/** How the sky outside moves: a fast day, the viewer's own clock or always afternoon; saved in this browser. */
function DaySettings() {
  const { mode } = useDayTime();
  return (
    <div className="day-settings" role="radiogroup" aria-label="Day and night">
      <span>Day and night</span>
      {(Object.keys(DAY_MODE_LABELS) as DayMode[]).map((m) => (
        <label key={m} className="toggle">
          <input type="radio" name="day-mode" checked={mode === m} onChange={() => setDayMode(m)} /> {DAY_MODE_LABELS[m]}
        </label>
      ))}
    </div>
  );
}

const GRAPHICS_LABELS: Record<GraphicsPreset, string> = { low: 'Low', medium: 'Medium', high: 'High', auto: 'Auto' };

/** Graphics quality: Low, Medium, High or Auto (which shows the tier it has settled on); saved in this browser. */
function GraphicsSettings() {
  const preset = useGfx((s) => s.preset);
  const tier = useGfx(effectiveTier);
  const blocked = useGfx((s) => s.blocked);
  return (
    <div className="day-settings" role="radiogroup" aria-label="Graphics quality">
      <span>Graphics</span>
      {GRAPHICS_PRESETS.map((p) => (
        <label key={p} className="toggle">
          <input type="radio" name="graphics" checked={preset === p} onChange={() => setGraphicsPreset(p)} /> {GRAPHICS_LABELS[p]}
        </label>
      ))}
      {blocked ? (
        <span className="muted small">Effects are off: {blocked}.</span>
      ) : (
        preset === 'auto' && <span className="muted small">now {GRAPHICS_LABELS[tier]}</span>
      )}
    </div>
  );
}

function Help() {
  return (
    <Panel title="How the office works">
      <div className="help">
        <h3>Moving around</h3>
        <p>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> (or the arrow keys) walk · <kbd>Shift</kbd> run · mouse to look · <kbd>E</kbd> or left click interacts with whatever the crosshair is on (the first click only grabs the mouse) · <kbd>Esc</kbd> frees the mouse and
          drops whatever you're holding. Closing a panel or changing floor grabs it again.
        </p>
        <MouseSettings />
        <h3>Balls</h3>
        <p>
          Walk into a ball to push it, or aim at one and press <kbd>E</kbd> (or click) to pick it up. Click or press <kbd>F</kbd> to throw: a tap lobs it, holding charges a harder throw. <kbd>G</kbd> drops it at your feet.
          With a ball in hand, <kbd>E</kbd> still works on desks, boards and the elevator (the ball drops when a panel opens), and <kbd>E</kbd> on another ball swaps them.
        </p>
        <p>
          Every floor has a basketball hoop on the south wall, with its ball waiting underneath. Aim at the painted square on the backboard and fill the throw meter about half to three quarters of the way: the ball
          arcs up and drops through the rim. A tap falls short and a full charge flies long. Hit someone with a ball or a dart and they react. Aim at the roomba and press <kbd>E</kbd> for a happy spin.
        </p>
        <h3>The office dog</h3>
        <p>
          One dog roams the whole building, taking the elevator between floors now and then. Aim at it and press <kbd>E</kbd> to pet it: it wiggles and follows you for a while (into the elevator too).
          Hold a ball and it watches it eagerly; throw it and it fetches it back to your feet. It naps on the couch or a rug when the floor is quiet, sits with anyone having a hard time
          (red checks, a third round of fixes, or a PR stuck for a human) and celebrates a merge with its author. Rename it in Settings.
        </p>
        <h3>Foam blasters</h3>
        <p>
          Every floor has a rack of foam blasters by the south wall: aim at it and press <kbd>E</kbd> to take one. <b>Fire</b>: click or <kbd>F</kbd> (12 darts, up to four a second). <b>Reload</b>: <kbd>R</kbd>. <b>Drop</b>: <kbd>G</kbd>, then <kbd>E</kbd> picks it up again.
          Darts stick to walls, boards and screens when they hit square on and bounce off everything else. They never open anything, and the blasters go back on the rack when you change floors.
        </p>
        <h3>Coffee</h3>
        <p>
          Every office floor's kitchenette has a coffee machine with a mug dispenser beside it. Aim at the dispenser and press <kbd>E</kbd> to take a mug, aim at the machine's drip tray and press <kbd>E</kbd> to
          put it under the spout, then press <kbd>E</kbd> on the machine's round button. After a few seconds of grinding and gurgling it beeps: aim at the mug and press <kbd>E</kbd> to take your coffee. You can
          take the mug out early (it keeps what it has).
        </p>
        <p>
          With coffee in hand, <kbd>E</kbd> takes a sip wherever you're looking (except at the machine). A full mug is three sips: the last is one big gulp, and then you drop the empty mug. <kbd>G</kbd> drops
          your mug at any time, and mugs can't be thrown. Aim at a dropped mug and press <kbd>E</kbd> to pick it up again, coffee and all. Any mug that isn't full can go back under the machine for a refill.
        </p>
        <h3>Sound</h3>
        <p>
          The office chimes when a PR is ready to merge, fails QA or gets merged, when someone hits an error and when a new teammate arrives. A merge on the floor you're on bangs its gong (by the whiteboard) and the whole floor cheers; press <kbd>E</kbd> at the gong to bang it yourself. Every floor's jukebox plays in its corner: <kbd>E</kbd> on it skips to the next song, and its red button stops or starts the music. Its Focus button switches the floor to the Focus station (lo-fi beats and ambient tracks for heads-down work) and back to all songs. While you look at it, <kbd>−</kbd> and <kbd>+</kbd>, the mouse wheel or its own − and + buttons set its volume, from quiet background up to music that fills the whole floor; the meter on its card shows the level, and each floor keeps its own volume and station. The music dips under the gong, alerts and voices, and goes quiet while a panel or the phone is open and in the elevator. Wherever no jukebox can be heard, a quiet soundtrack follows the office's mood: soft and calm, a gentle pulse when the team is busy, darker under a red CI or a PR that needs you, slower at night, and a little fanfare after a merge (a bigger one on a streak). Every space sounds like itself, from the glassy lobby and the carpeted floors to the tiled kitchenette, the boxy elevator and the open balconies, and sounds behind a wall come through muffled. <kbd>M</kbd> mutes or unmutes anywhere. Under the master volume, turn
          footsteps (yours and everyone's), typing (and the team's chatter), toys (balls, blasters, coffee and the roomba), alerts (the phone, the elevator, the gong and these cues), music (the jukebox), voice (messages read aloud), outside (wind, the city, birds by day and crickets at night, heard out on a balcony or through an open side door) and the soundtrack up or down on their own, or switch the soundtrack off. Your
          settings are saved in this browser.
        </p>
        <SoundControls />
        <h3>Outside</h3>
        <p>The sky outside the windows has its own day: a whole one every 30 minutes, the time on your own clock, or always a sunny afternoon.</p>
        <DaySettings />
        <h3>Graphics</h3>
        <p>
          <b>Low</b> is the plain cartoon look and the lightest on your laptop. <b>Medium</b> adds glow: screens, lamps, the jukebox and, after dark, the city's windows and the moon, and the monitors light up desks and faces at
          night. <b>High</b> adds soft shadows where things meet the floor and colour that follows the time of day. <b>Auto</b> starts on High and steps down when frames get slow, then back up once there's room. Saved in this
          browser.
        </p>
        <GraphicsSettings />
        <h3>The building</h3>
        <p>
          The ground floor is the lobby: your office is the glass room at the back left, the CEO's corner office is at the back right, and candidates wait on the chairs by the entrance. Every connected GitHub repo gets its own
          floor. To travel, walk into the elevator in the middle of the south wall and press <kbd>E</kbd> on its panel. In the lobby, the directory beside it works too.
        </p>
        <p>
          The elevator's top stop is the roof terrace (<kbd>R</kbd> on its panel). Sit back in a deck chair (<kbd>E</kbd>; walk or press <kbd>E</kbd> to get up), grill a sausage at the barbecue (<kbd>E</kbd> puts one
          on and turns it, <kbd>E</kbd> again takes it once it's done, then <kbd>E</kbd> eats it a bite at a time), or look through the telescope (<kbd>E</kbd>; the mouse aims and the wheel zooms): the
          billboards on the rooftops by day, the moon and the constellations at night. The string lights come on at dusk. Idle teammates go up for a break now and then, and the CEO takes calls up there.
        </p>
        <h3>Mission control</h3>
        <p>
          The curved bank of screens behind reception shows the whole company at a glance: the pipeline (issues ready, being built, in QA, being fixed, ready to merge, needing you), merges today and over the last 24 hours, lead time, QA wait and CI, who's busy, and an estimate of today's cost. Each floor's team sign has a short line of its own numbers. The bottom middle screen is Claude's usage meter: while the office paces itself after a usage warning, press <kbd>E</kbd> on it to resume full speed (if you've topped up or your usage was reset). When a PR needs you, or someone has been stuck on an error for 10 minutes, the beacon on top spins (and the one on that floor's sign) with a calm chime: press <kbd>E</kbd> on it to open the console at that card. The manager's console has it all too, under Mission control.
        </p>
        <h3>Your phone</h3>
        <p>
          Press <kbd>P</kbd> anywhere to pull out your phone. Text the CEO, approve or decline the people they want to hire, see every project at a glance, or play Cubetris, Cable Snake or look after your Desk Pet while the team works. The red badge counts decisions and messages waiting for you. In the chat, and in an agent's
          terminal, <kbd>Enter</kbd> sends and <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line. To talk instead of type, hold the 🎙️ next to Send, or hold <kbd>V</kbd> in the message box, and speak: your
          words fill the box to edit before you send (a tap of the 🎙️ listens until you stop talking, and <kbd>Esc</kbd> stops listening). With 🎧 Hands-free on, the phone listens for a few seconds after
          the CEO's spoken reply and sends what you say. Settings → Voice picks the browser's speech recognition or ElevenLabs.
        </p>
        <h3>Who's working</h3>
        <p>
          The list at the top right shows everyone who is working right now (on this floor, or on every floor from the lobby) with their latest thought, reply or tool call. Click someone to watch their screen. <kbd>Tab</kbd>{' '}
          shows or hides it.
        </p>
        <h3>The CEO</h3>
        <p>
          The CEO studies every new floor, writes its QA brief, gives each agent a job that fits the project, turns your project briefs into issues and proposes hires. Hires wait for your approval unless you switch hiring to
          auto in the manager's console.
        </p>
        <h3>Your team</h3>
        <p>
          Each agent is a real coding agent running in its own terminal, working in its own git worktree. Walk up behind them to read their laptop, or press <kbd>E</kbd> (or click) on a desk to open their terminal: watch it live, type into it, send them instructions, stop them or hand them another issue. Aim at an empty desk and press <kbd>E</kbd> to hire, or click it and confirm.
        </p>
        <p>
          <b>⚙️ Setup</b>, at the top of their panel, changes their name, look, coding agent, model, effort, title, specialty and job description. Changes apply from their next task, so nothing is interrupted.
          Open <b>What they're told</b> there to read the full prompt the office gives them, with their job description highlighted. The CEO's model, effort and prompt are in the console's CEO tab.
        </p>
        <h3>Coins, decorations and trophies</h3>
        <p>
          Every merged PR earns its floor coins (🪙 at the top right): 10 a merge, 5 more when QA passed it first time, 5 when its checks were green first time, and 10 for the third merge on a floor within an hour. Nothing
          ever costs coins but the catalogue. Spend them at the catalogue kiosk in the lobby; what you buy waits in the floor's 📦 decor box by its elevator. Take something out, walk to a glowing spot and press <kbd>E</kbd>:
          it snaps in. <kbd>E</kbd> on a placed decoration picks it up to move it, and the box puts things away. The arcade cabinet plays your phone's games. Achievements fill the trophy shelf in the lobby: <kbd>E</kbd> on a
          trophy says what it was for and when.
        </p>
        <p>
          Desks tell their owner's story: a plaque on the monitor for every merged PR, a gold star for ten first-time QA passes, specialty stickers, and a plant, a photo and a desk toy that arrive with time on the team. Look at a
          desk for a moment to see its career card (or open <b>🏅 Career</b> in their panel); the console's Team tab compares everyone.
        </p>
        <h3>The QA lab</h3>
        <p>
          The testers in lab coats along the east wall check every pull request before it can be merged. They run the tests, click through the change in a real browser, and post a report with screenshots on the PR. If a PR
          fails, it goes back to the developer who wrote it, who fixes it and sends it back to QA.
        </p>
        <h3>The whiteboard</h3>
        <p>
          <b>Backlog</b>: open issues nobody has picked up. <b>In progress</b>: developers at work. <b>In QA</b>: being tested or fixed. <b>Ready to merge</b>: QA passed, waiting for you. Press <kbd>E</kbd> or click the board to
          assign, send to QA, merge and file new issues. When a PR merges, confetti bursts over the desk of the developer who wrote it.
        </p>
        <p>
          Aim at a sticky and it lifts off the board: <kbd>E</kbd> (or a click) reads it up close. <kbd>G</kbd>, or holding the click, peels a Backlog sticky off: carry it to a free developer's desk and press <kbd>E</kbd> and
          they start that issue (the sticky goes on their monitor). A PR waiting to go to QA can be carried to the QA lab the same way. Anywhere else, <kbd>G</kbd> puts it back. Red strings join an issue to the one it
          depends on until that one closes, and the corner of the board counts today's merges, the time from issue to merge, the QA queue and anything that needs you.
        </p>
        <p>
          The big screen to the left of the whiteboard shows the floor's app once its preview is running: press <kbd>E</kbd> or click it to open the app. With PRs open, its bottom row
          has a channel for each: aim at one and press <kbd>E</kbd> to run that PR beside the main app (at most two PR previews run at once). In the viewer, <b>Compare with main</b> puts
          them side by side, and the PR's checks and QA report sit beside it.
        </p>
      </div>
    </Panel>
  );
}

export function Overlays() {
  const overlay = useStore((s) => s.overlay);
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'terminal':
      return overlay.agentId === CEO_ID ? <ManagerConsole initialTab="ceo" /> : <TerminalView agentId={overlay.agentId} />;
    case 'phone':
      return <Phone tab={overlay.tab} requestId={overlay.requestId} />;
    case 'kanban':
      return <KanbanView repoId={overlay.repoId} />;
    case 'card':
      return <CardView repoId={overlay.repoId} cardKey={overlay.key} number={overlay.number} pr={overlay.pr} />;
    case 'app':
      return <AppViewer repoId={overlay.repoId} pr={overlay.pr} />;
    case 'elevator':
      return <ElevatorPanel />;
    case 'manager':
      return <ManagerConsole initialTab={overlay.tab} initialRepo={overlay.repoId} card={overlay.card} />;
    case 'help':
      return <Help />;
    case 'catalogue':
      return <Catalogue repoId={overlay.repoId} />;
    case 'decor-box':
      return <DecorBoxPanel repoId={overlay.repoId} />;
  }
}
