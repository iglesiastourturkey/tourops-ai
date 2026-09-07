import { Link, useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { historicalRemediationApi } from '@/lib/historical-remediation-api';

function valueText(value: unknown) { return value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
export default function HistoricalRemediationDetailPage() {
  const [, params] = useRoute('/historical-remediation/:id');
  const id = Number(params?.id);
  const query = useQuery({ queryKey: ['historical-remediation', id], queryFn: () => historicalRemediationApi.get(id), enabled: Number.isInteger(id) && id > 0 });
  const row = query.data;
  return <AppShell title="Kaynak Kanıtı"><main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    <Link href="/historical-remediation"><Button variant="ghost"><ArrowLeft className="mr-2 h-4 w-4"/>Kuyruğa dön</Button></Link>
    {query.isLoading && <Card className="p-8 text-center">Yükleniyor…</Card>}{query.isError && <Card className="p-8 text-center text-destructive">Kayıt bulunamadı veya erişilemedi.</Card>}
    {row && <><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-[#1e3a5f]">{row.customerName || 'İsimsiz kayıt'}</h1><Badge>{row.derivedState}</Badge></div><p className="text-xs text-muted-foreground">{row.sourceKey}</p></div>
      <Card className="p-5"><h2 className="font-semibold">Tarihsel kayıt</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(row.historicalRecord).map(([key, value]) => <div key={key}><p className="text-xs text-muted-foreground">{key}</p><p className="break-words text-sm">{valueText(value)}</p></div>)}</div><div className="mt-4 flex flex-wrap gap-2">{row.warnings.map(warning => <Badge variant="outline" key={warning}>{warning}</Badge>)}</div><p className="mt-4 text-xs text-muted-foreground">Payload SHA256: {row.payloadSha256} · bütünlük: {row.payloadHashIntegrity ? 'geçerli' : 'geçersiz'}</p></Card>
      <Card className="p-5"><h2 className="font-semibold">Kaynak kanıtı</h2>{!row.evidence ? <p className="mt-3 text-sm text-muted-foreground">Bu kayıt için kanıt snapshot’ı henüz yüklenmedi.</p> : <><p className="mt-2 text-sm text-muted-foreground">{row.evidence.workbookPath} · {row.evidence.worksheetName} · satır {row.evidence.sourceRow} (başlık {row.evidence.headerRow})</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Hücre</th><th className="p-2">Başlık</th><th className="p-2">Görüntülenen değer</th><th className="p-2">Ham değer</th><th className="p-2">Boş</th></tr></thead><tbody>{row.evidence.cells.map(cell => <tr key={cell.address} className="border-b"><td className="p-2 font-mono">{cell.address}</td><td className="p-2">{cell.header ?? '—'}</td><td className="p-2">{cell.displayValue ?? '—'}</td><td className="max-w-xs break-all p-2 font-mono text-xs">{valueText(cell.rawValue)}</td><td className="p-2">{cell.isBlank ? 'Evet' : 'Hayır'}</td></tr>)}</tbody></table></div><p className="mt-4 break-all text-xs text-muted-foreground">Workbook SHA256: {row.evidence.workbookSha256}<br/>Evidence SHA256: {row.evidence.evidenceSha256}</p></>}</Card>
      <Card className="p-5"><h2 className="font-semibold">Provenans</h2><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(row.provenance, null, 2)}</pre></Card>
    </>}
  </main></AppShell>;
}
