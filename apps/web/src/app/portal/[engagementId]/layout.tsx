import type { ReactNode } from 'react'

// Isolated portal layout: no dashboard chrome, no staff sidebar, no
// demo banner. External clients only see their project.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="antialiased">{children}</div>
}

export const metadata = {
  title: 'Your MADFAM project',
  description: 'Live status for your engagement with MADFAM.',
}
