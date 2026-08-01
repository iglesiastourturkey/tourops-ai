import { useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useListQuotations } from '@workspace/api-client-react';
import { Plus, Search, ExternalLink } from 'lucide-react';
import { QUOTATION_STATUS_LABELS, QUOTATION_STATUS_COLORS, formatCurrency, formatDate } from '@/lib/labels';

export default function QuotationsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { data: quotations, isLoading } = useListQuotations();

  const filtered = (quotations ?? []).filter(q => {
    const ms = !search || q.number.toLowerCase().includes(search.toLowerCase());
    const mst = statusFilter === 'all' || q.status === statusFilter;
    return ms && mst;
  });

  return (
    <AppShell title="Teklifler">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Teklif no ara..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-quotations" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" data-testid="select-quotation-status-filter"><SelectValue placeholder="Tüm Durumlar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Durumlar</SelectItem>
            {Object.entries(QUOTATION_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Link href="/quotations/new"><Button className="gap-2" data-testid="button-new-quotation"><Plus className="w-4 h-4" />Yeni Teklif</Button></Link>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Teklif No</TableHead>
              <TableHead className="hidden md:table-cell">Son Geçerlilik</TableHead>
              <TableHead>Tutar</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="w-16">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Teklif bulunamadı</TableCell></TableRow>
            ) : filtered.map(q => (
              <TableRow key={q.id} data-testid={`row-quotation-${q.id}`}>
                <TableCell className="font-mono text-sm font-medium">{q.number}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{formatDate(q.expiresAt)}</TableCell>
                <TableCell className="font-semibold">{formatCurrency(q.finalPrice, q.currency)}</TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${QUOTATION_STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>{QUOTATION_STATUS_LABELS[q.status] ?? q.status}</span></TableCell>
                <TableCell>
                  <Link href={`/quotations/${q.id}`}><Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-view-quotation-${q.id}`}><ExternalLink className="w-3.5 h-3.5" /></Button></Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
