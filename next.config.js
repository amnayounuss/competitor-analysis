/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The job runner imports CommonJS scrapers — needed for Node-style require() to resolve
    serverComponentsExternalPackages: ['puppeteer', 'xlsx'],
  },
  /**
   * Proxy the browser's Supabase traffic through this app's own origin.
   *
   * The browser used to talk to Kong directly on port 8000. That port is not
   * reachable from outside this host — connection watchers showed page loads
   * arriving on :3000 while :8000 received nothing at all, so every login POST
   * died in the network before reaching GoTrue. Routing through /sb means only
   * the app's own port has to be open, and the same build works whether it is
   * reached by public IP or through an SSH tunnel.
   */
  async rewrites() {
    const target = process.env.SUPABASE_INTERNAL_URL || 'http://localhost:8000';
    return [{ source: '/sb/:path*', destination: `${target}/:path*` }];
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
