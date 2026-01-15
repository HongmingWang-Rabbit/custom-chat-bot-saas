/** @type {import('next').NextConfig} */
const nextConfig = {
  // Moved from experimental.serverComponentsExternalPackages in Next.js 16
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],

  // Empty turbopack config to acknowledge Turbopack as default
  turbopack: {},

  // Webpack config (used when running with --webpack flag)
  webpack: (config) => {
    // Fix for pdf-parse compatibility with webpack
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
