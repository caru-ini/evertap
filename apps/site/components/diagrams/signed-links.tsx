import { DATABASE_HOST, STORAGE_PORTS } from "@evertap/api/rules";
import {
  AppWindowIcon,
  DeviceMobileIcon,
  GlobeIcon,
  LinkSimpleIcon,
} from "@phosphor-icons/react/ssr";

import { Diagram, Group, Item, Mark, Panel, Sequence } from "./parts.tsx";

import styles from "./signed-links.module.css";

/** A bucket reachable from anywhere: signed links take buckets' own address, the app's other calls keep to ev.internal. */
export function SignedLinks() {
  return (
    <Diagram
      label={`A phone or a preview deployment opens a signed link at https://s3.example.com, which your proxy or tunnel passes to evertap's entry on port 9900. Your app's other calls keep going to ${DATABASE_HOST}:${STORAGE_PORTS.garage}.`}
    >
      <Panel
        icon={<LinkSimpleIcon />}
        title="Reachable from anywhere"
        note={`Signed links take an address of buckets' own. Everything else stays on ${DATABASE_HOST}.`}
      >
        <div className={styles.columns}>
          <Group label="A signed link">
            <Sequence>
              <Item icon={<DeviceMobileIcon />} code="a phone, a preview">
                Opens the link
              </Item>
              <Item icon={<GlobeIcon />} code="https://s3.example.com">
                Your proxy or tunnel
              </Item>
              <Item icon={<Mark engine="garage" />} code="through evertap, port 9900">
                The bucket
              </Item>
            </Sequence>
          </Group>
          <Group label="Every other call">
            <Sequence>
              <Item icon={<AppWindowIcon />} code="AWS_ENDPOINT_URL_S3">
                Your app
              </Item>
              <Item
                icon={<Mark engine="garage" />}
                code={`${DATABASE_HOST}:${STORAGE_PORTS.garage}`}
              >
                The bucket
              </Item>
            </Sequence>
          </Group>
        </div>
      </Panel>
    </Diagram>
  );
}
