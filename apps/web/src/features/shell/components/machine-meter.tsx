import { USAGE_CRITICAL_RATIO, USAGE_WARNING_RATIO } from "@evertap/api/rules";
import type { SystemStatus } from "@evertap/api/schemas";
import { useSidebar } from "@evertap/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@evertap/ui/components/tooltip";
import { cx } from "@evertap/ui/lib/cx";
import {
  CaretRightIcon,
  CpuIcon,
  HardDriveIcon,
  type Icon,
  MemoryIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { formatBytes } from "@/lib/format.ts";

import styles from "./machine-meter.module.css";

type Gauge = {
  label: string;
  icon: Icon;
  /** Used share, 0–1; undefined until the first status arrives. */
  ratio: number | undefined;
  detail: string;
};

/** Grey, then amber, then red as the used share climbs. */
const levelClass = (ratio: number | undefined) => {
  if (ratio === undefined || ratio < USAGE_WARNING_RATIO) return undefined;
  return ratio < USAGE_CRITICAL_RATIO ? styles.warning : styles.critical;
};

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

const usedRatio = (capacity: { totalBytes: number; freeBytes: number }) =>
  capacity.totalBytes > 0 ? (capacity.totalBytes - capacity.freeBytes) / capacity.totalBytes : 0;

const gauges = (status: SystemStatus | undefined): [Gauge, Gauge, Gauge] => [
  {
    label: "CPU",
    icon: CpuIcon,
    ratio: status?.cpu.usedRatio,
    detail: status
      ? `CPU ${percent(status.cpu.usedRatio)} of ${status.cpu.cores} cores`
      : "Checking CPU",
  },
  {
    label: "Memory",
    icon: MemoryIcon,
    ratio: status ? usedRatio(status.memory) : undefined,
    detail: status
      ? `Memory ${formatBytes(status.memory.totalBytes - status.memory.freeBytes)} used of ${formatBytes(status.memory.totalBytes)}`
      : "Checking memory",
  },
  {
    label: "Disk",
    icon: HardDriveIcon,
    ratio: status ? usedRatio(status.disk) : undefined,
    detail: status
      ? `Disk ${formatBytes(status.disk.freeBytes)} free of ${formatBytes(status.disk.totalBytes)}`
      : "Checking free space",
  },
];

// pathLength=100 lets the dash array be the used percentage; the rotation starts it at 12 o'clock.
const Ring = ({ gauge }: { gauge: Gauge }) => (
  <span className={styles.gauge}>
    <svg aria-hidden viewBox="0 0 24 24" className={styles.ring}>
      <circle cx="12" cy="12" r="10.5" fill="none" strokeWidth="2" className={styles.track} />
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill="none"
        strokeWidth="2"
        pathLength={100}
        strokeDasharray={`${Math.round((gauge.ratio ?? 0) * 100)} 100`}
        className={styles.progress}
      />
    </svg>
    <gauge.icon aria-hidden weight="bold" className={styles.icon} />
  </span>
);

/** In the sidebar, CPU, memory, and disk as rings around their icons with the used share beside each. */
export const MachineMeter = ({ status }: { status: SystemStatus | undefined }) => {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const all = gauges(status);
  // The rail has room for one ring: the busiest, so a problem shows even when collapsed.
  const busiest = all.reduce((top, gauge) => ((gauge.ratio ?? 0) > (top.ratio ?? 0) ? gauge : top));

  return (
    <>
      <Link
        to="/doctor"
        aria-label={`${all.map((gauge) => gauge.detail).join(". ")}. Open Doctor`}
        onClick={closeOnMobile}
        className={styles.row}
      >
        {all.map((gauge) => (
          <Tooltip key={gauge.label}>
            <TooltipTrigger render={<span className={cx(styles.cell, levelClass(gauge.ratio))} />}>
              <Ring gauge={gauge} />
              <span className={styles.value}>
                {gauge.ratio === undefined ? "—" : percent(gauge.ratio)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{gauge.detail}</TooltipContent>
          </Tooltip>
        ))}
        <CaretRightIcon aria-hidden weight="bold" className={styles.caret} />
      </Link>

      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/doctor"
              aria-label={`${busiest.detail}. Open Doctor`}
              className={cx(styles.railButton, levelClass(busiest.ratio))}
            />
          }
        >
          <Ring gauge={busiest} />
        </TooltipTrigger>
        <TooltipContent side="right">{busiest.detail}</TooltipContent>
      </Tooltip>
    </>
  );
};
