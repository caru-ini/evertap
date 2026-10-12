import { DATABASE_HOST } from "@evertap/api/rules";
import {
  AppWindowIcon,
  BrowserIcon,
  GitBranchIcon,
  HardDrivesIcon,
  LaptopIcon,
} from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Arrow, Diagram, EvertapAndDocker, Flow, Group, Item, Panel, Then } from "./parts.tsx";

import styles from "./install-paths.module.css";

/** The two ways evertap runs: on one machine that others reach, or on the computer you develop on. */
export function InstallPaths() {
  return (
    <Diagram
      label={`On a home server or VPS, laptops, CI, and browsers reach the one machine that runs evertap and its databases in Docker. On the computer you develop on, your apps reach them at ${DATABASE_HOST} on the same machine.`}
    >
      <div className={styles.panels}>
        <Panel
          icon={<HardDrivesIcon />}
          title="On a home server or VPS"
          note="One machine runs the databases. Laptops, CI, and browsers reach it."
        >
          <div className={styles.hub}>
            <ul className={styles.clients}>
              <li>
                <Item icon={<LaptopIcon />} code="evertap connect">
                  Laptops
                </Item>
              </li>
              <li>
                <Item icon={<GitBranchIcon />} code="EVERTAP_API_KEY">
                  CI
                </Item>
              </li>
              <li>
                <Item icon={<BrowserIcon />}>Browsers</Item>
              </li>
            </ul>
            <span className={styles.join}>
              <Arrow down />
            </span>
            <Group
              label={
                <>
                  <Brand name="linux" />
                  Linux
                </>
              }
            >
              <EvertapAndDocker />
            </Group>
          </div>
        </Panel>
        <Panel
          icon={<LaptopIcon />}
          title="On the computer you develop on"
          note="Your apps and the databases on one machine, nothing to run on a laptop."
        >
          <Group
            label={
              <>
                <Brand name="apple" />
                <Brand name="linux" />
                macOS or Linux
              </>
            }
          >
            <Flow>
              <Item icon={<AppWindowIcon />} code={DATABASE_HOST}>
                Your apps
              </Item>
              <Then />
              <EvertapAndDocker />
            </Flow>
          </Group>
        </Panel>
      </div>
    </Diagram>
  );
}
