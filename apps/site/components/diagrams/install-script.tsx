import {
  DownloadSimpleIcon,
  PlayIcon,
  PowerIcon,
  QuestionIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";

import { Brand } from "../brand.tsx";
import { Diagram, Item, Panel, Sequence } from "./parts.tsx";

import styles from "./install-script.module.css";

type Step = { icon: ReactNode; text: string; code: string; tone?: "led" };

const ASK: Step = {
  icon: <QuestionIcon />,
  text: "Asks where it runs: answer 1",
  code: "The machine that runs evertap",
  tone: "led",
};
const INSTALL: Step = {
  icon: <DownloadSimpleIcon />,
  text: "Installs the binary",
  code: "/usr/local/bin/evertap",
};

const STEPS: Record<"linux" | "macos", Step[]> = {
  linux: [
    ASK,
    { icon: <Brand name="docker" />, text: "Checks that you can use Docker", code: "docker group" },
    INSTALL,
    { icon: <PowerIcon />, text: "Starts evertap at boot", code: "evertap@<you>" },
    { icon: <PlayIcon />, text: "Runs setup, the first time", code: "evertap setup" },
  ],
  macos: [
    ASK,
    { icon: <Brand name="docker" />, text: "Checks that Docker is running", code: "docker.sock" },
    INSTALL,
    { icon: <PowerIcon />, text: "Leaves starting evertap to you", code: "evertap serve" },
  ],
};

/** What the install script does on the machine that runs evertap, in order. */
export function InstallScript({ system }: { system: "linux" | "macos" }) {
  const steps = STEPS[system];
  return (
    <Diagram
      label={`The install script ${steps.map(({ text }) => text.toLowerCase()).join(", then ")}.`}
    >
      <Panel
        icon={<TerminalWindowIcon />}
        title={
          <code className={styles.command}>curl -fsSL https://evertap.dev/install.sh | sh</code>
        }
        note={system === "linux" ? "What it does on Linux with systemd" : "What it does on a Mac"}
      >
        <Sequence>
          {steps.map(({ icon, text, code, tone }) => (
            <Item key={text} icon={icon} code={code} tone={tone}>
              {text}
            </Item>
          ))}
        </Sequence>
      </Panel>
    </Diagram>
  );
}
