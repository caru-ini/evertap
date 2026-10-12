import { DATABASE_ADDRESS, DATABASE_HOST, DATABASE_PORTS } from "@evertap/api/rules";
import { LogoMark } from "@evertap/ui/components/logo";
import { AppWindowIcon, DatabaseIcon, LaptopIcon, ProhibitIcon } from "@phosphor-icons/react/ssr";

import { Diagram, Flow, Item, Panel, Then } from "./parts.tsx";

import styles from "./local-addresses.module.css";

const PORT = DATABASE_PORTS.postgresql;

/** Why a database of your own on 127.0.0.1 keeps working beside evertap, and one on every address does not. */
export function LocalAddresses() {
  return (
    <Diagram
      label={`In This computer only, evertap listens on ${DATABASE_ADDRESS}, so a database of your own on 127.0.0.1:${PORT} keeps working beside it. One published on every address, such as Compose's "${PORT}:${PORT}", takes the port from evertap.`}
    >
      <Panel
        icon={<LaptopIcon />}
        title="This computer only"
        note={`evertap listens on a loopback address of its own, ${DATABASE_ADDRESS}.`}
      >
        <div className={styles.rows}>
          <Flow even>
            <Item icon={<AppWindowIcon />} code={`${DATABASE_HOST}:${PORT}`}>
              Your apps
            </Item>
            <Then />
            <Item icon={<LogoMark />} code={`${DATABASE_ADDRESS}:${PORT}`}>
              evertap
            </Item>
          </Flow>
          <Flow even>
            <Item icon={<AppWindowIcon />} code={`localhost:${PORT}`}>
              Your apps
            </Item>
            <Then />
            <Item icon={<DatabaseIcon />} code={`127.0.0.1:${PORT}`}>
              A database of your own
            </Item>
          </Flow>
          <Item icon={<ProhibitIcon />} code={`"${PORT}:${PORT}" in a Compose file`} tone="amber">
            Every address, evertap's too
          </Item>
        </div>
      </Panel>
    </Diagram>
  );
}
