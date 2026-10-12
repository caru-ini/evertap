import { FolderSimpleIcon, NetworkIcon, PlugIcon } from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Diagram, Item, Panel } from "./parts.tsx";

import styles from "./docker-needs.module.css";

export function DockerNeeds() {
  return (
    <Diagram label="evertap's container needs Docker's socket, the data directory at the same path as on the host, and the host's network.">
      <Panel
        icon={<Brand name="docker" />}
        title={<code className={styles.image}>ghcr.io/caru-ini/evertap</code>}
        note="Its container needs three things most containers do not."
      >
        <ul className={styles.items}>
          <li>
            <Item icon={<PlugIcon />} code="/var/run/docker.sock">
              Docker's socket
            </Item>
          </li>
          <li>
            <Item icon={<FolderSimpleIcon />} code="/var/lib/evertap:/var/lib/evertap">
              The data directory, at the same path
            </Item>
          </li>
          <li>
            <Item icon={<NetworkIcon />} code="network_mode: host">
              The host's network
            </Item>
          </li>
        </ul>
      </Panel>
    </Diagram>
  );
}
