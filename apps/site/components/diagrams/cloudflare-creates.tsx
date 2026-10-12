import { LogoMark } from "@evertap/ui/components/logo";
import { CloudSlashIcon, GlobeIcon, PathIcon } from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Diagram, Group, Item, Panel } from "./parts.tsx";

import styles from "./cloudflare-creates.module.css";

export function CloudflareCreates() {
  return (
    <Diagram label="Once you approve evertap, it creates a tunnel named evertap, a DNS record for each of its two names, and a Cache Rule in Cloudflare, and runs cloudflared on this machine. It keeps the tunnel's token, and no Cloudflare credential.">
      <Panel
        icon={<Brand name="cloudflare" />}
        title="What evertap creates"
        note="Once you approve it in Cloudflare. It keeps no Cloudflare credential."
      >
        <div className={styles.columns}>
          <Group
            label={
              <>
                <Brand name="cloudflare" />
                In your Cloudflare account
              </>
            }
          >
            <ul className={styles.items}>
              <li>
                <Item icon={<PathIcon />} code="evertap">
                  A tunnel
                </Item>
              </li>
              <li>
                <Item icon={<GlobeIcon />} code="evertap.example.com, s3.example.com">
                  A DNS record for each name
                </Item>
              </li>
              <li>
                <Item icon={<CloudSlashIcon />} code="no cache for s3.example.com">
                  A Cache Rule
                </Item>
              </li>
            </ul>
          </Group>
          <Group
            label={
              <>
                <Brand name="linux" />
                On this machine
              </>
            }
          >
            <ul className={styles.items}>
              <li>
                <Item icon={<Brand name="docker" />} code="evertap-cloudflared">
                  cloudflared
                </Item>
              </li>
              <li>
                <Item icon={<LogoMark />} code="kept by evertap">
                  The tunnel's token
                </Item>
              </li>
            </ul>
          </Group>
        </div>
      </Panel>
    </Diagram>
  );
}
