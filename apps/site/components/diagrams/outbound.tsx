import { LogoMark } from "@evertap/ui/components/logo";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ssr";

import { Brand, type BrandName } from "../brand.tsx";
import { Arrow, Diagram, Item, Panel } from "./parts.tsx";

import styles from "./outbound.module.css";

const PLACES: { brand: BrandName; name: string; why: string }[] = [
  { brand: "docker", name: "Docker Hub", why: "images, pinned by digest" },
  { brand: "github", name: "GitHub", why: "the latest release, once a day" },
  { brand: "cloudflare", name: "Cloudflare", why: "only for a tunnel it created" },
];

export function Outbound() {
  return (
    <Diagram
      label={`On its own, evertap connects to ${PLACES.map(({ name, why }) => `${name}, for ${why}`).join("; ")}. It has no telemetry and no account.`}
    >
      <Panel
        icon={<ArrowSquareOutIcon />}
        title="What evertap connects to"
        note="No telemetry, no account, nothing about your data or your machine."
      >
        <div className={styles.tree}>
          <span className={styles.root}>
            <Item icon={<LogoMark />}>evertap</Item>
          </span>
          <ul className={styles.places}>
            {PLACES.map(({ brand, name, why }) => (
              <li key={name}>
                <Arrow down />
                <Item icon={<Brand name={brand} />} code={why} wrap>
                  {name}
                </Item>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </Diagram>
  );
}
