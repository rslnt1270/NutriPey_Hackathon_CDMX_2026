import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  experimental: { cpus: 2 },
};

export default config;
