import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import Link from "next/link";

import { Command } from "../../components/command.tsx";
import { Trademarks } from "../../components/trademarks.tsx";
import { GITHUB_URL } from "../../lib/layout.tsx";
import { Create } from "./diagrams/create.tsx";
import { Lifecycle } from "./diagrams/lifecycle.tsx";
import { NoDb } from "./diagrams/no-db.tsx";
import { Overview } from "./diagrams/overview.tsx";
import { SameEnv } from "./diagrams/same-env.tsx";

import styles from "./page.module.css";

const INSTALL = "curl -fsSL https://evertap.dev/install.sh | sh";
const SHOT_ALT = "evertap's web UI listing databases and buckets, grouped by service";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>One box that hands out databases and buckets.</h1>
        <p className={styles.lede}>
          evertap runs PostgreSQL®, MySQL®, Redis®, and S3-compatible buckets on Garage in Docker on
          your home server, a VPS, or the computer you develop on. Create one from the web UI or the
          CLI, then copy its connection details.
        </p>
        <Command value={INSTALL} />
        <div className={styles.actions}>
          <Link href="/docs/install" className={styles.primary}>
            Read the docs
          </Link>
          <a href={GITHUB_URL} className={styles.outline}>
            GitHub
          </a>
          <p className={styles.meta}>
            Runs on Linux or macOS with Docker, for development, not production. This version has no
            backups, does not run on Windows, and a laptop keeps <code>evertap connect</code> open
            in a terminal. <Link href="/docs/limitations">What else it does not do</Link>
          </p>
        </div>
      </section>

      {/* Taken from the demo (EVERTAP_DEMO=1) in each theme; replace both files together. Click to zoom. */}
      <figure className={styles.shot}>
        <span className={styles.lightShot}>
          <ImageZoom src="/screenshot-light.png" alt={SHOT_ALT}>
            <img src="/screenshot-light.png" alt={SHOT_ALT} width={1280} height={800} />
          </ImageZoom>
        </span>
        <span className={styles.darkShot}>
          <ImageZoom src="/screenshot-dark.png" alt={SHOT_ALT}>
            <img
              src="/screenshot-dark.png"
              alt={SHOT_ALT}
              width={1280}
              height={800}
              loading="lazy"
            />
          </ImageZoom>
        </span>
      </figure>

      <section className={styles.section} aria-labelledby="no-db">
        <h2 id="no-db" className={styles.heading}>
          No <code>db:</code> in each Compose file
        </h2>
        <NoDb />
      </section>

      <section className={styles.section} aria-labelledby="same-env">
        <h2 id="same-env" className={styles.heading}>
          The same <code>.env</code> wherever evertap runs
        </h2>
        <SameEnv />
      </section>

      <section className={styles.section} aria-labelledby="services">
        <h2 id="services" className={styles.heading}>
          One box for five services
        </h2>
        <Overview />
        <p className={styles.note}>
          Each service keeps its own license (
          <a href={`${GITHUB_URL}#engines-and-their-licenses`}>the list</a>).
        </p>
      </section>

      <section className={styles.section} aria-labelledby="create">
        <h2 id="create" className={styles.heading}>
          Create, then copy
        </h2>
        <Create />
      </section>

      <section className={styles.section} aria-labelledby="lifecycle">
        <h2 id="lifecycle" className={styles.heading}>
          Temporary, kept, or protected
        </h2>
        <Lifecycle />
      </section>

      <section className={styles.section} aria-labelledby="start">
        <h2 id="start" className={styles.heading}>
          Get started
        </h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <h3>Install</h3>
            <Command value={INSTALL} />
            <p>
              The script checks the download against the release&apos;s checksums.{" "}
              <Link href="/docs/install">Install</Link>
            </p>
          </li>
          <li className={styles.step}>
            <h3>Choose how it is reached</h3>
            <Command value="evertap setup" />
            <p>
              With <code>evertap serve</code> running, pick this computer only, your network, or a
              Cloudflare Tunnel. <Link href="/docs/modes">Modes</Link>
            </p>
          </li>
          <li className={styles.step}>
            <h3>Create a database</h3>
            <Command value="evertap create postgres blog" />
            <p>
              It prints the connection URL. On a laptop, <code>evertap connect</code> carries it to
              evertap. <Link href="/docs/connecting">Connect</Link>
            </p>
          </li>
        </ol>
      </section>

      <footer className={styles.footer}>
        <nav className={styles.links} aria-label="Project">
          <a href={GITHUB_URL}>GitHub</a>
          <a href="https://github.com/sponsors/caru-ini">Sponsor</a>
          <a href={`${GITHUB_URL}/blob/main/LICENSE`}>Apache License 2.0</a>
        </nav>
        <Trademarks />
      </footer>
    </main>
  );
}
