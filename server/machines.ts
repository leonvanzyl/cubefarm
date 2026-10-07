// Agents' machines (docs/agents.md): every agent works on a machine of its own, with its own clone of its floor's
// repository, its worktree of that clone (where its branches are checked out) and its temp folder. Today a machine is
// a folder on this computer (the local provider, server/workspace.ts); a container or a cloud VM is another
// MachineProvider behind the same calls. A machine is named after its agent (machineName), so a rename moves nothing.

import fs from 'node:fs';
import * as workspace from './workspace.ts';
import type { DeskBase, DeskTrim, OfficeProcesses } from './workspace.ts';

export interface MachineProvider {
  /** Where the agent's worktree of a repository is: their sessions run there. */
  deskDir(machine: string, fullName: string): string;
  /** Put the agent's worktree on `branch` for a task; their clone is made the first time. */
  prepareDesk(machine: string, fullName: string, base: DeskBase, branch: string, note?: (text: string) => void): Promise<string>;
  /** What every session on the machine runs with, on top of the office's environment. */
  env(machine: string): Record<string, string>;
  /** Stop what the agent left running: on their port, or started in their worktree. */
  release(machine: string, fullName: string, port: number): Promise<void>;
  /** Free disk space on an idle worktree (node_modules, build output); null when there's none or it's busy. */
  trimDesk(machine: string, fullName: string, stillIdle: () => boolean): Promise<DeskTrim | null>;
  /** Delete finished swarm/qa branches in the agent's clone that nothing in `keep` names; returns how many went. */
  sweep(machine: string, fullName: string, keep: string[]): Promise<number>;
  /** Remove the machine; work on no remote branch is saved to leftovers first. removed: false while it's in use. */
  remove(machine: string): Promise<{ removed: boolean; patches: string[] }>;
  /** The machines that exist. */
  list(): Promise<string[]>;
}

/** An agent's machine: the start of their id, which never changes (a short name keeps Windows paths short). */
export const machineName = (agentId: string) => agentId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'agent';

/** Machines as folders on this computer. `keep`: the office's own processes, which releasing a machine never stops. */
export function localMachines(keep: () => OfficeProcesses): MachineProvider {
  return {
    deskDir: (machine, fullName) => workspace.machineDesk(machine, fullName),
    prepareDesk: (machine, fullName, base, branch, note) => workspace.prepareMachineDesk(machine, fullName, base, branch, note),
    env: (machine) => {
      const tmp = workspace.machineTmp(machine);
      fs.mkdirSync(tmp, { recursive: true });
      return { TMP: tmp, TEMP: tmp, TMPDIR: tmp };
    },
    release: (machine, fullName, port) => workspace.releaseMachine(machine, fullName, port, keep()),
    trimDesk: (machine, fullName, stillIdle) => workspace.trimMachineDesk(machine, fullName, stillIdle),
    sweep: (machine, fullName, keepBranches) => workspace.sweepMachine(machine, fullName, keepBranches),
    remove: (machine) => workspace.removeMachine(machine),
    list: () => workspace.listMachines(),
  };
}
