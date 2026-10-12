import { LogoMark } from "@evertap/ui/components/logo";
import { BrowserIcon } from "@phosphor-icons/react/ssr";

import { Brand } from "../brand.tsx";
import { Diagram, Flow, Group, Item, Panel, Sequence, Then } from "./parts.tsx";

export function TunnelPath() {
  return (
    <Diagram label="Browsers and laptops open https://evertap.example.com at Cloudflare, which passes them through the tunnel to cloudflared on the machine running evertap. cloudflared connected out to Cloudflare on TCP 7844, so the machine takes no incoming connections.">
      <Panel
        icon={<Brand name="cloudflare" />}
        title="Anywhere, through Cloudflare"
        note="The machine connects out to Cloudflare, and takes no incoming connections."
      >
        <Sequence>
          <Item icon={<BrowserIcon />} code="https://evertap.example.com">
            Browsers and laptops
          </Item>
          <Item icon={<Brand name="cloudflare" />} code="the tunnel evertap created">
            Cloudflare
          </Item>
          <Group
            label={
              <>
                <Brand name="linux" />
                The machine that runs evertap, no open ports
              </>
            }
          >
            <Flow>
              <Item icon={<Brand name="docker" />} code="connects out, TCP 7844">
                cloudflared
              </Item>
              <Then />
              <Item icon={<LogoMark />} code="127.0.0.1:8080">
                evertap
              </Item>
            </Flow>
          </Group>
        </Sequence>
      </Panel>
    </Diagram>
  );
}
