import { DATABASE_HOST } from "@evertap/api/rules";
import { LogoMark } from "@evertap/ui/components/logo";
import { AppWindowIcon, ProhibitIcon } from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Diagram, Engines, Flow, Group, Item, Panel, Then } from "./parts.tsx";

import styles from "./wsl.module.css";

export function Wsl() {
  return (
    <Diagram
      label={`Inside WSL, your apps reach evertap at ${DATABASE_HOST}. Windows apps outside WSL do not.`}
    >
      <Panel
        icon={<Brand name="windows" />}
        title="Windows"
        note={`Only what runs inside WSL reaches ${DATABASE_HOST}.`}
      >
        <div className={styles.split}>
          <Group
            label={
              <>
                <Brand name="linux" />
                WSL, with Docker
              </>
            }
          >
            <Flow>
              <Item icon={<AppWindowIcon />} code={DATABASE_HOST}>
                Your apps
              </Item>
              <Then />
              <Item icon={<LogoMark />} code="evertap serve">
                evertap
                <Engines />
              </Item>
            </Flow>
          </Group>
          <Item icon={<ProhibitIcon />} code={`No ${DATABASE_HOST}`} tone="amber">
            Windows apps
          </Item>
        </div>
      </Panel>
    </Diagram>
  );
}
