/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@libsql/client', 'libsql'],
  // 不再略過 TypeScript 型別檢查（ignoreBuildErrors 已移除）：型別錯誤會讓 build 失敗
  images: {
    unoptimized: true,
  },
}

export default nextConfig
