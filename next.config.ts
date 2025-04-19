import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fls-na.amazon.com',
        port: '',
        pathname: '/**',
      },
      // Add other allowed hostnames here if needed
    ],
  },
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
