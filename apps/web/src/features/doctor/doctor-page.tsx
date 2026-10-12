import {
  ACCESS_CHOICE_NAMES,
  DATABASE_ADDRESS,
  TUNNEL_STATES,
  USAGE_CRITICAL_RATIO,
  USAGE_WARNING_RATIO,
} from "@evertap/api/rules";
import type { Capacity, DoctorReport } from "@evertap/api/schemas";
import { cx } from "@evertap/ui/lib/cx";
import {
  ArrowCircleUpIcon,
  ArrowSquareOutIcon,
  CloudIcon,
  CpuIcon,
  DoorOpenIcon,
  GlobeSimpleIcon,
  PackageIcon,
  PlugsIcon,
  StackIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ResourceIcon } from "@/components/resource-icon.tsx";
import { formatBytes } from "@/lib/format.ts";
import { orpc } from "@/lib/orpc.ts";
import { ENGINE_INFO } from "@/lib/resource-engines.ts";

import styles from "./doctor-page.module.css";

type Light = "ok" | "busy" | "warning" | "fault" | "off";

const LIGHT_CLASS = {
  ok: styles.ok,
  busy: styles.busy,
  warning: styles.warning,
  fault: styles.fault,
  off: styles.off,
} satisfies Record<Light, string | undefined>;

const ENGINE_STATE = {
  starting: { light: "busy", text: "Starting" },
  ready: { light: "ok", text: "Running" },
  failed: { light: "fault", text: "Couldn't start. Restart evertap to try again" },
  unavailable: { light: "off", text: "Not available yet" },
} satisfies Record<DoctorReport["engines"][number]["state"], { light: Light; text: string }>;

const TUNNEL_LIGHT = {
  connected: "ok",
  connecting: "busy",
  stopped: "fault",
} satisfies Record<NonNullable<DoctorReport["tunnel"]>["state"], Light>;

const DOCKER_WARNING_LABEL = {
  outdated: "Version",
  snap: "Snap package",
  rootless: "Rootless mode",
} satisfies Record<NonNullable<DoctorReport["docker"]>["warnings"][number]["kind"], string>;

const usageLight = (ratio: number): Light => {
  if (ratio >= USAGE_CRITICAL_RATIO) return "fault";
  return ratio >= USAGE_WARNING_RATIO ? "warning" : "ok";
};

const usedRatio = (capacity: Capacity) =>
  capacity.totalBytes > 0 ? (capacity.totalBytes - capacity.freeBytes) / capacity.totalBytes : 0;

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

const Section = ({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) => (
  <section aria-label={label} className={styles.group}>
    <h2 className={styles.band}>
      {icon}
      {label}
    </h2>
    <ul className={styles.rows}>{children}</ul>
  </section>
);

const Check = ({
  light,
  label,
  value,
  detail,
}: {
  light: Light;
  label: ReactNode;
  value: string;
  /** A local-only note, such as a path or the error an engine gave. */
  detail?: string;
}) => (
  <li className={styles.row}>
    <span aria-hidden className={cx(styles.light, LIGHT_CLASS[light])} />
    <span className={styles.label}>{label}</span>
    <span className={styles.value}>
      {value}
      {detail ? <code className={styles.detail}>{detail}</code> : null}
    </span>
  </li>
);

export const DoctorPage = () => {
  const { data: report } = useSuspenseQuery(orpc.system.doctor.queryOptions());
  const { cpu, memory, disk } = report.machine;
  const memoryRatio = usedRatio(memory);
  const diskRatio = usedRatio(disk);
  const local = report.access === "local";
  // In local mode the name must lead to evertap's own address, not merely resolve.
  const named = report.lan
    ? local
      ? report.lan.addresses.includes(DATABASE_ADDRESS)
      : report.lan.addresses.length > 0
    : false;
  const holder = (address: string) =>
    report.conflicts.find((conflict) => conflict.running && conflict.address === address)?.name;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Doctor</h1>
        <p className={styles.intro}>
          What evertap checks on the machine it runs on. The checks run again every 10 seconds.
        </p>
        <p className={styles.intro}>
          evertap <span className={styles.mono}>{report.version}</span>
        </p>
      </header>

      {report.update ? (
        <Section icon={<ArrowCircleUpIcon aria-hidden />} label="Update">
          <Check
            light="warning"
            label={
              <a
                href={report.update.url}
                target="_blank"
                rel="noreferrer"
                className={styles.release}
              >
                evertap <span className={styles.mono}>{report.update.version}</span>
                <ArrowSquareOutIcon aria-hidden className={styles.external} />
              </a>
            }
            value={report.update.advice}
          />
        </Section>
      ) : null}

      {report.docker ? (
        <Section icon={<WrenchIcon aria-hidden />} label="Docker">
          <Check
            light={report.docker.reachable ? "ok" : "fault"}
            label="Docker"
            value={
              report.docker.reachable
                ? `Answering${report.docker.version ? ` · ${report.docker.version}` : ""} · API ${report.docker.apiVersion}`
                : "Not answering. Start Docker, then restart evertap"
            }
            detail={report.docker.socket}
          />
          {report.docker.warnings.map(({ kind, message }) => (
            <Check key={kind} light="warning" label={DOCKER_WARNING_LABEL[kind]} value={message} />
          ))}
        </Section>
      ) : (
        <p className={styles.intro}>
          Demo mode starts nothing, so Docker, the engines, and their entries are not checked.
        </p>
      )}

      {report.engines.length > 0 ? (
        <Section icon={<StackIcon aria-hidden />} label="Engines">
          {report.engines.map(({ engine, state, error }) => (
            <Check
              key={engine}
              light={ENGINE_STATE[state].light}
              label={
                <>
                  <ResourceIcon engine={engine} className={styles.engineIcon} />
                  {ENGINE_INFO[engine].label}
                </>
              }
              value={ENGINE_STATE[state].text}
              detail={error}
            />
          ))}
        </Section>
      ) : null}

      {report.lan || report.entries.length > 0 ? (
        <Section icon={<PlugsIcon aria-hidden />} label="Connections">
          <Check
            light={report.access ? "ok" : "warning"}
            label={
              <>
                <DoorOpenIcon aria-hidden className={styles.engineIcon} />
                Access
              </>
            }
            value={
              report.access
                ? ACCESS_CHOICE_NAMES[report.access].label
                : "Not set up yet. Run evertap setup on the machine running evertap to choose how browsers reach it"
            }
          />
          {report.tunnel ? (
            <Check
              light={TUNNEL_LIGHT[report.tunnel.state]}
              label={
                <>
                  <CloudIcon aria-hidden className={styles.engineIcon} />
                  <span className={styles.mono}>{report.tunnel.hostname}</span>
                </>
              }
              value={[
                TUNNEL_STATES[report.tunnel.state].label,
                report.tunnel.state === "connected"
                  ? `${report.tunnel.connections} ${report.tunnel.connections === 1 ? "link" : "links"} to Cloudflare`
                  : TUNNEL_STATES[report.tunnel.state].advice,
              ].join(" · ")}
              detail={report.tunnel.error}
            />
          ) : null}
          {report.lan ? (
            <Check
              light={named ? "ok" : "fault"}
              label={
                <>
                  <GlobeSimpleIcon aria-hidden className={styles.engineIcon} />
                  <span className={styles.mono}>{report.lan.host}</span>
                </>
              }
              value={
                named
                  ? report.lan.addresses.join(", ")
                  : local
                    ? "Doesn't lead to evertap yet. Run evertap setup on this machine"
                    : "Doesn't resolve on this machine. Give it an address in your network's DNS"
              }
            />
          ) : null}
          {report.entries.map(({ engine, address, reachable }) => {
            // What answers there is the other program.
            const taken = holder(address);
            return (
              <Check
                key={engine}
                light={reachable && !taken ? "ok" : "fault"}
                label={
                  <>
                    <ResourceIcon engine={engine} className={styles.engineIcon} />
                    <span className={styles.mono}>{address}</span>
                  </>
                }
                value={
                  taken
                    ? `Taken by ${taken}`
                    : reachable
                      ? "Answering"
                      : "Not answering. Restart evertap"
                }
              />
            );
          })}
          {report.conflicts.map(({ name, address, running, message }) => (
            <Check
              key={`${name} ${address}`}
              light={running ? "fault" : "warning"}
              label={
                <>
                  <PackageIcon aria-hidden className={styles.engineIcon} />
                  <span className={styles.mono}>{name}</span>
                </>
              }
              value={message}
            />
          ))}
        </Section>
      ) : null}

      <Section icon={<CpuIcon aria-hidden />} label="Machine">
        <Check
          light={usageLight(cpu.usedRatio)}
          label="CPU"
          value={`${percent(cpu.usedRatio)} of ${cpu.cores} cores`}
        />
        <Check
          light={usageLight(memoryRatio)}
          label="Memory"
          value={`${percent(memoryRatio)} · ${formatBytes(memory.totalBytes - memory.freeBytes)} used of ${formatBytes(memory.totalBytes)}`}
        />
        <Check
          light={usageLight(diskRatio)}
          label="Disk"
          value={`${percent(diskRatio)} · ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}${diskRatio >= USAGE_WARNING_RATIO ? ". Delete resources you no longer need" : ""}`}
          detail={report.dataDir}
        />
      </Section>
    </section>
  );
};
