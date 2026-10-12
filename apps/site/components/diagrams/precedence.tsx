import {
  ArrowCounterClockwiseIcon,
  FloppyDiskIcon,
  KeyIcon,
  LaptopIcon,
  PlugIcon,
  SlidersHorizontalIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";

import { Diagram, Item, Panel, Sequence } from "./parts.tsx";

type Choice = { icon: ReactNode; text: string; code?: string };

const ORDERS: Record<
  "settings" | "cli",
  { icon: ReactNode; title: string; note: string; choices: Choice[] }
> = {
  settings: {
    icon: <SlidersHorizontalIcon />,
    title: "How a setting is decided",
    note: "The first that has a value wins.",
    choices: [
      { icon: <TerminalWindowIcon />, text: "Its environment variable", code: "EVERTAP_MODE" },
      { icon: <FloppyDiskIcon />, text: "What setup or Settings saved", code: "evertap.db" },
      { icon: <ArrowCounterClockwiseIcon />, text: "The mode's default" },
    ],
  },
  cli: {
    icon: <TerminalWindowIcon />,
    title: "Which evertap the CLI uses",
    note: "The first that applies.",
    choices: [
      { icon: <KeyIcon />, text: "An API key", code: "EVERTAP_API_KEY, EVERTAP_URL" },
      {
        icon: <PlugIcon />,
        text: "Its socket, on the machine running evertap",
        code: "evertap.sock",
      },
      {
        icon: <LaptopIcon />,
        text: "What evertap login saved",
        code: "~/.config/evertap/config.json",
      },
    ],
  },
};

/** An order of fallbacks: what evertap or its CLI takes first, then next. */
export function Precedence({ of }: { of: "settings" | "cli" }) {
  const { icon, title, note, choices } = ORDERS[of];
  return (
    <Diagram label={`${title}: ${choices.map(({ text }) => text).join(", then ")}.`}>
      <Panel icon={icon} title={title} note={note}>
        <Sequence>
          {choices.map((choice) => (
            <Item key={choice.text} icon={choice.icon} code={choice.code}>
              {choice.text}
            </Item>
          ))}
        </Sequence>
      </Panel>
    </Diagram>
  );
}
