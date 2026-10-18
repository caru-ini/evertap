/** What the CLI writes to the terminal and asks the person there. */

import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

/** What the person typed wrong; printed without a stack. */
export class UsageError extends Error {}

// Annotated so TypeScript knows code after a call is unreachable.
export const fail: (message: string) => never = (message) => {
  throw new UsageError(message);
};

export const print = (text = "") => {
  process.stdout.write(`${text}\n`);
};

export const warn = (text: string) => {
  process.stderr.write(`${text}\n`);
};

/** How long an opener that cannot open a browser takes to fail, at most. */
const OPEN_FAILS_MS = 1000;

/** Opens `url` in this machine's browser; false when there is none to open, as over SSH. */
export const openBrowser = async (url: string) => {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    // An opener may stay until the browser it started closes, so one still running has opened it.
    const stillRunning = new Promise<number>((resolve) => {
      setTimeout(() => resolve(0), OPEN_FAILS_MS).unref();
    });
    const code = await Promise.race([child.exited, stillRunning]);
    child.unref();
    return code === 0;
  } catch {
    // Not installed, as xdg-open on most servers.
    return false;
  }
};

/** Ctrl+C ends the command as it would outside a prompt, instead of with a stack. */
const interrupt = () => {
  process.stdout.write("\n");
  process.kill(process.pid, "SIGINT");
};

export const ask = async (question: string) => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  prompt.on("SIGINT", interrupt);
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
};

/** Like `ask`, but what is typed or pasted stays off the screen. */
export const askSecret = async (question: string) => {
  process.stdout.write(question);
  const prompt = createInterface({
    input: process.stdin,
    output: new Writable({ write: (_chunk, _encoding, done) => done() }),
    terminal: true,
  });
  prompt.on("SIGINT", interrupt);
  try {
    return (await prompt.question("")).trim();
  } finally {
    prompt.close();
    process.stdout.write("\n");
  }
};

export type Choice<T> = {
  value: T;
  label: string;
  hint?: string;
  /** Shown beside the label: the value unless given, such as for a flag; nothing for null. */
  tag?: string | null;
};

/** Picks one of `choices` with the arrow keys and Enter, starting at `initial`. */
export const choose = <T extends string>(question: string, choices: Choice<T>[], initial: T) =>
  new Promise<T>((resolve) => {
    const { stdin, stdout } = process;
    let at = Math.max(
      0,
      choices.findIndex((choice) => choice.value === initial),
    );
    const width = Math.max(...choices.map((choice) => choice.label.length));
    let drawn = 0;
    const draw = () => {
      const lines = choices.flatMap((choice, index) => [
        `  ${index === at ? ">" : " "} ${choice.tag === null ? choice.label : `${choice.label.padEnd(width)}  (${choice.tag ?? choice.value})`}`,
        ...(choice.hint ? [`      ${choice.hint}`] : []),
      ]);
      // Over the last drawing, so the list stays in place as the cursor moves.
      stdout.write(`${drawn > 0 ? `\x1b[${drawn}A\x1b[J` : ""}${lines.join("\n")}\n`);
      drawn = lines.length;
    };
    const stop = () => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onKey = (_: unknown, key: { name?: string; ctrl?: boolean } | undefined) => {
      const chosen = choices[at];
      if (key?.ctrl && key.name === "c") {
        stop();
        interrupt();
      } else if (key?.name === "up" || key?.name === "k") {
        at = (at + choices.length - 1) % choices.length;
        draw();
      } else if (key?.name === "down" || key?.name === "j") {
        at = (at + 1) % choices.length;
        draw();
      } else if (
        // Enter typed before raw mode is on arrives as a newline, which Node names `enter`.
        (key?.name === "return" || key?.name === "enter") &&
        chosen
      ) {
        stop();
        // The list gives way to the answer, as a typed answer stays beside its question.
        stdout.write(`\x1b[${drawn + 1}A\x1b[J? ${question} ${chosen.label}\n`);
        resolve(chosen.value);
      }
    };
    print(`? ${question}`);
    draw();
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on("keypress", onKey);
    stdin.resume();
  });
