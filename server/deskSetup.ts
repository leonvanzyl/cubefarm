// Setting up an agent's desk for a new task (Swarm.prepare), in the order that keeps the desk folder clearable.

/** An agent's terminal, as far as setting up the desk cares. */
export interface IdleCli {
  /** Closes a CLI waiting at its prompt, settling once it has exited; null while a CLI drives a session. */
  releaseIdle: (() => Promise<void>) | null;
}

export interface DeskSteps {
  /** Stop what the last task left running (dev servers, anything started in the desk). */
  release(): Promise<void>;
  /** Put the desk on the task's branch; resolves to its folder. */
  prepare(): Promise<string>;
}

/**
 * Close the agent's idle CLI first: its working directory is the desk, and on Windows a folder can't be removed while
 * a process has it as its working directory. A new task starts a new session anyway (fixes resume theirs by id). A CLI
 * driving a session has no releaseIdle, so it's never closed here.
 */
export async function setUpDesk(term: IdleCli | null | undefined, steps: DeskSteps): Promise<string> {
  await term?.releaseIdle?.();
  await steps.release();
  return steps.prepare();
}
