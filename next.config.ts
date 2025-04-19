import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Exclude re2 from bundling for server-side code
    if (isServer) {
      config.externals.push("re2");
    }
    // Important: return the modified config
    return config;
  },
};

export default nextConfig;
