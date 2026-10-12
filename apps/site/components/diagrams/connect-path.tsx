import { DATABASE_ADDRESS, DATABASE_HOST, DATABASE_PORTS } from "@evertap/api/rules";
import { AppWindowIcon, LaptopIcon, PlugIcon } from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Diagram, EvertapAndDocker, Flow, Group, Hop, Item, Panel, Then } from "./parts.tsx";

import styles from "./connect-path.module.css";

const URL_HOST = `${DATABASE_HOST}:${DATABASE_PORTS.postgresql}`;

/** How a connection to ev.internal reaches a database, from a laptop and on the machine itself. */
export function ConnectPath() {
  return (
    <Diagram
      label={`From a laptop, an app connects to ${URL_HOST}, where evertap connect listens on ${DATABASE_ADDRESS} and carries the connection over a WebSocket to evertap. On the machine running evertap in local mode, apps connect to evertap directly.`}
    >
      <div className={styles.panels}>
        <Panel
          icon={<LaptopIcon />}
          title="From a laptop"
          note="In network and cloudflare mode, evertap connect carries each connection."
        >
          <div className={styles.stack}>
            <Group
              label={
                <>
                  <Brand name="apple" />
                  <Brand name="linux" />
                  Your laptop
                </>
              }
            >
              <Flow even>
                <Item icon={<AppWindowIcon />} code={URL_HOST}>
                  Your apps
                </Item>
                <Then />
                <Item icon={<PlugIcon />} code={DATABASE_ADDRESS}>
                  evertap connect
                </Item>
              </Flow>
            </Group>
            <Hop>a WebSocket to evertap's address</Hop>
            <Group
              label={
                <>
                  <Brand name="linux" />
                  The machine that runs evertap
                </>
              }
            >
              <EvertapAndDocker />
            </Group>
          </div>
        </Panel>
        <Panel
          icon={<LaptopIcon />}
          title="On the machine that runs evertap"
          note="In local mode, apps there connect to evertap directly."
        >
          <Group
            label={
              <>
                <Brand name="apple" />
                <Brand name="linux" />
                This computer
              </>
            }
          >
            <Flow>
              <Item icon={<AppWindowIcon />} code={URL_HOST}>
                Your apps
              </Item>
              <Then />
              <EvertapAndDocker code={DATABASE_ADDRESS} />
            </Flow>
          </Group>
        </Panel>
      </div>
    </Diagram>
  );
}
