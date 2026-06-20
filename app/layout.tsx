import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'Quita', template: '%s — Quita' },
  description: 'Gestão de cobranças recorrentes via WhatsApp e e-mail.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className={`${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  )
}
