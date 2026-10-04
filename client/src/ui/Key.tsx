import { useControls, useKeyName } from './controls';
import { keyLabel, type ActionId } from './keymap';

// The player's own keys on screen: help, hints and the tour show whatever is bound in Help → Controls.

/** `action`'s main key as a <kbd>. */
export function Key({ action }: { action: ActionId }) {
  return <kbd>{useKeyName(action)}</kbd>;
}

const MOVES: ActionId[] = ['forward', 'left', 'back', 'right'];

/** The four walking keys: one <kbd> when `joined` and they're all single letters (WASD), otherwise one each. */
export function MoveKeys({ joined = false }: { joined?: boolean }) {
  const names = useControls((s) => MOVES.map((a) => (s.bindings[a][0] ? keyLabel(s.bindings[a][0]) : '—')).join('\u0000'));
  const list = names.split('\u0000');
  if (joined && list.every((n) => n.length === 1)) return <kbd>{list.join('')}</kbd>;
  return (
    <>
      {list.map((n, i) => (
        <kbd key={i}>{n}</kbd>
      ))}
    </>
  );
}
