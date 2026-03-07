import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'
import { TRPCProvider } from '@/lib/trpc/provider'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Phyne CRM',
  description: 'Synthetic Single Pane of Glass for MADFAM ecosystem',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <TRPCProvider>{children}</TRPCProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
