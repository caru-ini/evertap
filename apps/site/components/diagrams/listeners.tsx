import {
  BrowserIcon,
  LaptopIcon,
  PlugIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Diagram, Group, Item, Panel, Sequence } from "./parts.tsx";

import styles from "./listeners.module.css";

/** In network and cloudflare mode, the UI is the one door; everything else listens on loopback. */
export function Listeners() {
  return (
    <Diagram label="In network and cloudflare mode, other machines reach only the UI and API, on the address you chose. The database and bucket entries, the services in Docker, and the CLI's socket are on loopback alone, reached through the UI's address by a signed-in evertap connect.">
      <Panel
        icon={<ShieldCheckIcon />}
        title="Only the UI faces other machines"
        note="In network and cloudflare mode. Buckets reached from anywhere add one more, beside it."
      >
        <Sequence>
          <Item icon={<LaptopIcon />} code="browsers, the CLI, evertap connect">
            Other machines
          </Item>
          <Item icon={<BrowserIcon />} code="the address you chose, port 8080">
            The UI and API
          </Item>
          <Group label="Loopback alone">
            <ul className={styles.items}>
              <li>
                <Item icon={<PlugIcon />} code="127.0.0.1: 6432 · 3306 · 6379 · 3900">
                  Database and bucket entries
                </Item>
              </li>
              <li>
                <Item icon={<Brand name="docker" />} code="127.0.0.1, on ports Docker picks">
                  The services in Docker
                </Item>
              </li>
              <li>
                <Item icon={<TerminalWindowIcon />} code="evertap.sock in the data directory">
                  The CLI's socket
                </Item>
              </li>
            </ul>
          </Group>
        </Sequence>
      </Panel>
    </Diagram>
  );
}
