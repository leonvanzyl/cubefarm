import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { TermClientMessage, TermServerMessage } from '../../../shared/types';

// An agent's real terminal: their CLI's screen streamed from the office (/ws/term), and what you type sent back to it.
// Opening it late shows everything so far: the office keeps a copy of each agent's screen and scrollback.

const THEME: ITheme = {
  background: '#1b1b29',
  foreground: '#eeeef6', // bright enough that dim text (drawn at half strength) still reads at 4.5:1
  cursor: '#ff9e64',
  cursorAccent: '#1b1b29',
  selectionBackground: '#44475a',
  black: '#21222c',
  red: '#ff6b6b',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#8aa4ff',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#e8e8f2',
  brightBlack: '#6c6f93',
  brightRed: '#ff8787',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#a4b9ff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

export function LiveTerminal({ agentId, className }: { agentId: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [connected, setConnected] = useState(true);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      cursorInactiveStyle: 'none',
      scrollback: 5000,
      allowProposedApi: true,
      scrollOnEraseInDisplay: true,
      theme: THEME,
      // Coloured output is nudged until it reads at 4.5:1 on the terminal's background (WCAG AA).
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank', 'noopener')));
    term.open(el);

    let ws: WebSocket | null = null;
    let closed = false;
    let ready = false; // the snapshot is on screen: sizes we send now describe what the viewer sees
    let retry: number | undefined;
    let frame = 0;
    const send = (m: TermClientMessage) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    const fitAndTell = () => {
      try {
        fit.fit();
      } catch {
        return; // not laid out yet
      }
      if (ready) send({ t: 'resize', cols: term.cols, rows: term.rows });
    };
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws/term?agent=${encodeURIComponent(agentId)}`);
      ws = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as TermServerMessage;
        if (m.t === 'snapshot') {
          // Replayed at the size it was drawn at, then fitted to this viewer (the CLI redraws for the new size).
          ready = false;
          term.reset();
          term.resize(m.cols, m.rows);
          term.write(m.data, () => {
            ready = true;
            fitAndTell();
            term.scrollToBottom();
          });
          setLive(m.live);
        } else if (m.t === 'data') term.write(m.data);
        else if (m.t === 'size' && (m.cols !== term.cols || m.rows !== term.rows)) term.resize(m.cols, m.rows);
        else if (m.t === 'live') setLive(m.live);
      };
      socket.onclose = (e) => {
        if (ws === socket) ws = null;
        if (closed) return;
        setConnected(false);
        if (e.code !== 4404) retry = window.setTimeout(connect, 1500);
      };
    };
    connect();

    const input = term.onData((data) => send({ t: 'input', data }));
    // Esc belongs to the CLI (it interrupts Claude Code) while you're typing in the terminal, not to the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    el.addEventListener('keydown', onKey);
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    term.textarea?.addEventListener('focus', onFocus);
    term.textarea?.addEventListener('blur', onBlur);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitAndTell);
    });
    ro.observe(el);
    void document.fonts?.ready.then(() => !closed && fitAndTell());

    return () => {
      closed = true;
      clearTimeout(retry);
      cancelAnimationFrame(frame);
      ro.disconnect();
      input.dispose();
      el.removeEventListener('keydown', onKey);
      ws?.close();
      term.dispose();
    };
  }, [agentId]);

  return (
    <div className={`live-term ${className ?? ''}`}>
      <div className="live-term-screen" ref={host} />
      <div className="live-term-foot">
        <span className={`live-dot ${live ? 'live-dot-on' : ''}`} />
        {!connected ? 'Reconnecting…' : live ? (focused ? 'Typing goes straight to the agent · Esc goes to them too; click outside to use the office keys' : 'Live · click the terminal to type into it') : 'Not running · a message below picks the session back up'}
      </div>
    </div>
  );
}
