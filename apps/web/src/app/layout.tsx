import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'
import { TRPCProvider } from '@/lib/trpc/provider'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: {
    default: 'Phyne — The Phygital CRM',
    template: '%s | Phyne',
  },
  description:
    'Phyne federates real-time data from your entire ecosystem into one unified CRM. No data duplication. No vendor lock-in.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TRPCProvider>{children}</TRPCProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
