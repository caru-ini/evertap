import type { NextConfig } from "next";

const config: NextConfig = {
  redirects() {
    return Promise.resolve([
      // 307 so browsers do not remember it; the script and the binaries stay on GitHub Releases.
      {
        source: "/install.sh",
        destination: "https://github.com/caru-ini/evertap/releases/latest/download/install.sh",
        permanent: false,
      },
      { source: "/docs", destination: "/docs/install", permanent: false },
    ]);
  },
};

export default config;
