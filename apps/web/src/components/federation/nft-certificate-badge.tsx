'use client'

import { Badge } from '@/components/ui/badge'

interface NftCertificateBadgeProps {
  url: string
}

export function NftCertificateBadge({ url }: NftCertificateBadgeProps) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <Badge variant="outline" className="cursor-pointer gap-1 text-xs hover:bg-accent">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label="Certificate shield icon"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        NFT Certificate
      </Badge>
    </a>
  )
}
