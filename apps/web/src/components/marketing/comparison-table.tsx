import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionWrapper } from './section-wrapper'

const rows = [
  {
    feature: 'Pricing Model',
    phynd: 'Free core / flat cloud tier',
    salesforce: 'Per seat, per month',
    hubspot: 'Freemium + per seat tiers',
    oss: 'Free (self-host only)',
  },
  {
    feature: 'Data Architecture',
    phynd: 'Real-time federation',
    salesforce: 'Centralized ETL',
    hubspot: 'Centralized ETL',
    oss: 'Local database only',
  },
  {
    feature: 'Manufacturing Integration',
    phynd: 'Native (PravaraMES)',
    salesforce: 'Custom connector',
    hubspot: 'Not available',
    oss: 'Build your own',
  },
  {
    feature: 'Digital Assets / 3D',
    phynd: 'Native (Forj)',
    salesforce: 'Not available',
    hubspot: 'Not available',
    oss: 'Not available',
  },
  {
    feature: 'Self-Hosting',
    phynd: 'Yes (AGPL-3.0 licensed)',
    salesforce: 'No',
    hubspot: 'No',
    oss: 'Yes',
  },
  {
    feature: 'API Federation',
    phynd: '5+ providers, circuit breaker',
    salesforce: 'REST/SOAP only',
    hubspot: 'REST only',
    oss: 'Varies',
  },
]

export function ComparisonTable() {
  return (
    <SectionWrapper>
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">How Phynd Compares</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Purpose-built for businesses that span physical and digital operations.
        </p>
      </div>
      <div className="reveal mt-12 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Feature</TableHead>
              <TableHead className="bg-primary/5 font-bold text-foreground">Phynd</TableHead>
              <TableHead>Salesforce</TableHead>
              <TableHead>HubSpot</TableHead>
              <TableHead>OSS CRMs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.feature}>
                <TableCell className="font-medium">{row.feature}</TableCell>
                <TableCell className="bg-primary/5 font-medium">{row.phynd}</TableCell>
                <TableCell className="text-muted-foreground">{row.salesforce}</TableCell>
                <TableCell className="text-muted-foreground">{row.hubspot}</TableCell>
                <TableCell className="text-muted-foreground">{row.oss}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SectionWrapper>
  )
}
