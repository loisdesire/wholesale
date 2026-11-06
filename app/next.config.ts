import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Every page in this app reads session-scoped, tenant-specific data (orders,
  // stock, conversations) that must always be current — static-by-default
  // Cache Components would require opting every route into dynamic rendering
  // individually for no benefit here, so it's off at the project level instead.
  // The dev-mode route badge sits bottom-left and collides with the nav's own
  // bottom-left "Sign out" control, eating clicks during development.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
