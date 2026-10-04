// Issue conventions shared by the server's scheduler and the client's whiteboard.

/** The specialty an issue is routed to, from its swarm:<specialty> label ('' = anyone). */
export function issueSpecialty(labels: string[]) {
  const l = labels.find((x) => /^swarm:/i.test(x) && !/^swarm:skip$/i.test(x));
  return l ? l.slice(6).toLowerCase() : '';
}

/** Open issues this issue waits for, from "Depends on #3" / "Blocked by #4, #5" in its body. */
export function blockers(body: string, open: Set<number>) {
  const out = new Set<number>();
  for (const m of (body ?? '').matchAll(/\b(?:depends\s+on|blocked\s+by)\s*:?\s*((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) if (open.has(Number(n[1]))) out.add(Number(n[1]));
  }
  return [...out];
}

/** Why an issue that waits for others can't start yet (the server's refusal and the whiteboard's warning say the same). */
export function waitsMessage(issue: number, waits: number[]) {
  const list = waits.map((n) => `#${n}`).join(', ');
  return `#${issue} waits for ${list}: it can start once ${waits.length === 1 ? 'that is' : 'those are'} closed`;
}

const DEPENDENCY = /\b(?:depends\s+on|blocked\s+by)\s*:?\s*(?:#\d+(?:\s*(?:,|and|&)\s*)?)+/gi;
const STATEMENT = new RegExp(`\\s*${DEPENDENCY.source}[.;,]?`, 'gi'); // with the space before it and a full stop after

/**
 * An issue body with its "Depends on #N" / "Blocked by #N" statements replaced by one "Depends on #a, #b" line at the
 * top ([] removes them). A line that only said that goes; the rest of the body is left alone.
 */
export function setDependsOn(body: string, deps: number[]) {
  const lines: string[] = [];
  let dropped = false;
  for (const line of (body ?? '').split(/\r?\n/)) {
    const rest = line.match(DEPENDENCY) ? line.replace(STATEMENT, '').trimEnd() : line;
    if (rest !== line && !/[\p{L}\p{N}]/u.test(rest)) {
      dropped = true;
      continue;
    }
    // A dropped line between two paragraphs doesn't leave a double gap.
    if (dropped && !rest.trim() && !lines[lines.length - 1]?.trim()) continue;
    dropped = false;
    lines.push(rest);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  const rest = lines.join('\n');
  if (deps.length === 0) return rest;
  return `Depends on ${deps.map((n) => `#${n}`).join(', ')}${rest ? `\n\n${rest}` : ''}`;
}

/**
 * How much of the backlog each open issue holds up: the longest chain of open issues waiting on it (`chain`) and how
 * many wait on it directly or indirectly (`waiting`). Starting the issues with the most behind them first lets the
 * most work run in parallel later.
 */
export function holdUps(issues: { number: number; body: string }[]) {
  const open = new Set(issues.map((i) => i.number));
  const waiters = new Map<number, number[]>();
  for (const i of issues) for (const b of blockers(i.body, open)) waiters.set(b, [...(waiters.get(b) ?? []), i.number]);
  const chains = new Map<number, number>();
  const visiting = new Set<number>();
  const chain = (n: number): number => {
    const known = chains.get(n);
    if (known !== undefined) return known;
    if (visiting.has(n)) return 0; // a dependency cycle
    visiting.add(n);
    const longest = Math.max(0, ...(waiters.get(n) ?? []).map((w) => chain(w) + 1));
    visiting.delete(n);
    chains.set(n, longest);
    return longest;
  };
  const out = new Map<number, { chain: number; waiting: number }>();
  for (const i of issues) {
    const seen = new Set<number>();
    const stack = [...(waiters.get(i.number) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === i.number || seen.has(n)) continue;
      seen.add(n);
      stack.push(...(waiters.get(n) ?? []));
    }
    out.set(i.number, { chain: chain(i.number), waiting: seen.size });
  }
  return out;
}
