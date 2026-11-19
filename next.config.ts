import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // L'Excel d'estoc de Spiga pesa ~0,5 MB; el límit per defecte de les Server Actions és 1 MB.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
