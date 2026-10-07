import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '../store';
import { Character } from './Character';
import { deskPosition, deskRotation } from './layout';
import { Ball, Box } from './Toon';

// People let go from the floor you're on: the store forgets them at once (their desk shows vacant), but they're
// still drawn at their old chair until the errand director has walked them out by the elevator with a box.

/**
 * Who left this floor's team while you were here, kept until `gone(id)`. The floor is keyed by repo, so changing
 * floors starts afresh and nobody "leaves" because you walked away.
 */
export function useLeavers(agents: Agent[]) {
  const [leavers, setLeavers] = useState<Agent[]>([]);
  const before = useRef<Map<string, Agent> | null>(null);
  useEffect(() => {
    const now = new Map(agents.map((a) => [a.id, a]));
    const left = before.current ? [...before.current.values()].filter((a) => !now.has(a.id)) : [];
    before.current = now;
    // Off the clock: no headphones, no typing.
    if (left.length) setLeavers((l) => [...l, ...left.map((a) => ({ ...a, status: 'stopped' as const, currentTool: null }))]);
  }, [agents]);
  const gone = useCallback((id: string) => setLeavers((l) => l.filter((a) => a.id !== id)), []);
  return { leavers, gone };
}

/** Their things in a cardboard box, held in front (Character's torso frame). */
const BOX = (
  <group position={[0, 0.2, -0.44]}>
    <Box size={[0.42, 0.24, 0.3]} color="#c99a5b" outline />
    <Ball r={0.07} position={[0.1, 0.16, 0.02]} color="#52b788" />
    <Box size={[0.06, 0.16, 0.04]} position={[-0.1, 0.16, 0]} color="#e07a5f" />
  </group>
);

/** Someone on their way out, drawn where they sat (a desk's chair is 0.8 m behind it). */
export function Leaver({ agent }: { agent: Agent }) {
  const { x, z } = deskPosition(agent.desk);
  return (
    <group position={[x, 0, z]} rotation={[0, deskRotation(agent.desk), 0]}>
      <group position={[0, 0, 0.8]}>
        <Character agent={agent} carrying={BOX} />
      </group>
    </group>
  );
}
