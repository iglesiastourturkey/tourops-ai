import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { historicalRemediationApi } from '@/lib/historical-remediation-api';

const fieldLabels: Record<string, string> = { pickupTime: 'Alış saati', passengerLanguage: 'Dil', pickupPoint: 'Alış noktası', adultCount: 'Yetişkin', externalOperator: 'Operatör' };
function OptionalSelect({ value, onChange, placeholder, values }: { value: string; onChange: (value: string) => void; placeholder: string; values: string[] }) {
  return <Select value={value || '__all__'} onValueChange={value => onChange(value === '__all__' ? '' : value)}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent><SelectItem value="__all__">{placeholder}: Tümü</SelectItem>{values.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>;
}

export default function HistoricalRemediationPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const query = useQuery({ queryKey: ['historical-remediation', params.toString()], queryFn: () => historicalRemediationApi.list(params) });
  const set = (key: string, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const facets = query.data?.facets;
  return <AppShell title="Tarihsel İyileştirme"><main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
    <div><h1 className="text-2xl font-bold text-[#1e3a5f]">Tarihsel İyileştirme</h1><p className="mt-1 text-sm text-muted-foreground">Kaynak kanıtını ve eksik alanları salt okunur inceleyin. Bu ekran hiçbir kaydı değiştirmez.</p></div>
    <Card className="grid gap-3 p-4 md:grid-cols-4">
      <div className="relative md:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-9" placeholder="Kaynak anahtarı, misafir, dosya veya sayfa ara" value={filters.search ?? ''} onChange={e => set('search', e.target.value)}/></div>
      <OptionalSelect value={filters.missingField ?? ''} onChange={v => set('missingField', v)} placeholder="Eksik alan" values={Object.keys(fieldLabels)} />
      <OptionalSelect value={filters.derivedState ?? ''} onChange={v => set('derivedState', v)} placeholder="Durum" values={['UNRESOLVED', 'READY_FOR_REVIEW']} />
      <OptionalSelect value={filters.workbook ?? ''} onChange={v => set('workbook', v)} placeholder="Çalışma kitabı" values={facets?.workbooks ?? []} />
      <OptionalSelect value={filters.month ?? ''} onChange={v => set('month', v)} placeholder="Ay" values={facets?.months ?? []} />
      <OptionalSelect value={filters.warningProfile ?? ''} onChange={v => set('warningProfile', v)} placeholder="Uyarı profili" values={facets?.warningProfiles ?? []} />
      <OptionalSelect value={filters.sourceKind ?? ''} onChange={v => set('sourceKind', v)} placeholder="Kaynak türü" values={facets?.sourceKinds ?? []} />
      <OptionalSelect value={filters.externalSource ?? ''} onChange={v => set('externalSource', v)} placeholder="Harici kaynak" values={['__blank__', ...(facets?.externalSources ?? [])]} />
      <OptionalSelect value={filters.externalOperator ?? ''} onChange={v => set('externalOperator', v)} placeholder="Operatör" values={['__blank__', ...(facets?.externalOperators ?? [])]} />
    </Card>
    {query.isLoading && <Card className="p-8 text-center text-muted-foreground">Yükleniyor…</Card>}
    {query.isError && <Card className="p-8 text-center text-destructive">Kuyruk yüklenemedi.</Card>}
    {query.data && <div className="space-y-3"><p className="text-sm text-muted-foreground">{query.data.total} kayıt</p>{query.data.rows.map(row => <Link key={row.id} href={`/historical-remediation/${row.id}`}><Card className="mb-3 cursor-pointer p-4 transition-colors hover:bg-muted/40"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{row.customerName || 'İsimsiz kayıt'}</p><p className="text-xs text-muted-foreground">{row.sourceKey}</p><p className="mt-1 text-sm">{row.operationDate} · {row.worksheetName} · satır {row.sourceRow}</p></div><Badge variant={row.derivedState === 'READY_FOR_REVIEW' ? 'default' : 'secondary'}>{row.derivedState === 'READY_FOR_REVIEW' ? 'İncelemeye Hazır' : `Çözülmedi · ${row.warnings.length} uyarı`}</Badge></div><div className="mt-3 flex flex-wrap gap-2">{row.missingFields.map(field => <Badge variant="outline" key={field}>{fieldLabels[field] ?? field}</Badge>)}{!row.hasSourceEvidence && <Badge variant="destructive">Kaynak kanıtı yok</Badge>}</div></Card></Link>)}</div>}
  </main></AppShell>;
}
