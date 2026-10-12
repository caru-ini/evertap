import { LogoMark } from "@evertap/ui/components/logo";
import {
  ArrowsLeftRightIcon,
  BrowserIcon,
  DeviceMobileIcon,
  LockIcon,
} from "@phosphor-icons/react/ssr";

import { Diagram, Group, Item, Panel, Sequence } from "./parts.tsx";

import styles from "./proxy-path.module.css";

export function ProxyPath() {
  return (
    <Diagram label="Browsers and laptops open https://evertap.example.com, and your proxy passes them to evertap on 127.0.0.1:8080. Buckets reached from anywhere take a second name, https://s3.example.com, passed to port 9900.">
      <Panel
        icon={<ArrowsLeftRightIcon />}
        title="Behind your own proxy"
        note="The proxy holds the certificate. evertap serves plain HTTP behind it."
      >
        <div className={styles.columns}>
          <Group label="evertap's address">
            <Sequence>
              <Item icon={<BrowserIcon />} code="https://evertap.example.com">
                Browsers and laptops
              </Item>
              <Item icon={<LockIcon />} code="Caddy, nginx, …">
                Your proxy
              </Item>
              <Item icon={<LogoMark />} code="127.0.0.1:8080">
                evertap
              </Item>
            </Sequence>
          </Group>
          <Group label="Buckets' address, if you want one">
            <Sequence>
              <Item icon={<DeviceMobileIcon />} code="https://s3.example.com">
                Signed links
              </Item>
              <Item icon={<LockIcon />} code="the same proxy">
                Your proxy
              </Item>
              <Item icon={<LogoMark />} code="127.0.0.1:9900">
                evertap's bucket entry
              </Item>
            </Sequence>
          </Group>
        </div>
      </Panel>
    </Diagram>
  );
}
