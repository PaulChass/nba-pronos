import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Inter } from 'next/font/google'
import { Nav } from '@/components/Nav'
import './globals.css'

const barlow = Barlow_Condensed({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-barlow' })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  // Absolute og:image URLs for link previews (WhatsApp, Facebook). Vercel sets
  // VERCEL_PROJECT_PRODUCTION_URL to the production domain (the custom one once it exists).
  metadataBase: new URL(
    process.env.SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'http://localhost:3000'),
  ),
  title: { default: 'Pronos NBA 2026-27', template: '%s · Pronos NBA' },
  description: 'Les pronos de la saison NBA 2026-27 entre potes : bilans, trophées, hot takes et classement en direct.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f2ec' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1014' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${barlow.variable} ${inter.variable}`}>
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  )
}
