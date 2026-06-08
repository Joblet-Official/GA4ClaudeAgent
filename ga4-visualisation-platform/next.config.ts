import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Brain code is server-only — never bundle openai key into the client.
  serverExternalPackages: ["openai"],
};

export default nextConfig;
