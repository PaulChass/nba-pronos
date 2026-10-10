/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Private game between friends: keep it out of search indexes.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }]
  },
}

export default nextConfig
