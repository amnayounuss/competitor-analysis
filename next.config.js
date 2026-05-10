/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The job runner imports CommonJS scrapers — needed for Node-style require() to resolve
    serverComponentsExternalPackages: ['puppeteer', 'xlsx'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      // Don't try to bundle puppeteer for the server build
      config.externals.push('puppeteer');
    }
    return config;
  },
};

module.exports = nextConfig;
