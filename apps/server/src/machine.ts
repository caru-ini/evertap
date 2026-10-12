import { readFile, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";

import type { MachineUsage } from "@evertap/api/schemas";

const cpuTimes = () =>
  cpus().reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );

// The kernel only counts busy time since boot, so the share is taken between two reads.
let lastTimes = cpuTimes();
let lastCpu = 0;

const readCpu = () => {
  const times = cpuTimes();
  const total = times.total - lastTimes.total;
  if (total > 0) {
    lastCpu = Math.min(1, Math.max(0, 1 - (times.idle - lastTimes.idle) / total));
    lastTimes = times;
  }
  return lastCpu;
};

/** MemTotal and MemAvailable from `/proc/meminfo` in bytes, or null when either is missing. */
export const parseMeminfo = (text: string): MachineUsage["memory"] | null => {
  const bytes = (field: string) => {
    const match = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(text);
    return match ? Number(match[1]) * 1024 : null;
  };
  const totalBytes = bytes("MemTotal");
  const freeBytes = bytes("MemAvailable");
  return totalBytes === null || freeBytes === null ? null : { totalBytes, freeBytes };
};

// In an LXC container Bun's totalmem gives the host's memory while freemem reads the container's
// /proc/meminfo, so both come from that file where it can be read.
const readMemory = async (): Promise<MachineUsage["memory"]> => {
  const text =
    process.platform === "linux" ? await readFile("/proc/meminfo", "utf8").catch(() => null) : null;
  // os.freemem reports available memory (page cache counts as free), like `free`'s "available"
  return (
    (text === null ? null : parseMeminfo(text)) ?? { totalBytes: totalmem(), freeBytes: freemem() }
  );
};

export const readMachine = async (path: string): Promise<MachineUsage> => {
  const stats = await statfs(path);
  return {
    disk: {
      totalBytes: stats.blocks * stats.bsize,
      // bavail, not bfree: the share a non-root process can actually use
      freeBytes: stats.bavail * stats.bsize,
    },
    memory: await readMemory(),
    cpu: { usedRatio: readCpu(), cores: cpus().length },
  };
};
