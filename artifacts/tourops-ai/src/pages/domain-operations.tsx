import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { customFetch } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, OPERATION_STATUS_LABELS } from '@/lib/labels';

type Kind = 'CRUISE' | 'SEJOUR';
interface Row { id:number; operationType:Kind; status:string; startDate:string|null; endDate:string|null; pickupTime:string|null;
  tourName:string|null; shipName:string|null; cruiseLine:string|null; portName:string|null; arrivalTime:string|null; departureTime:string|null;
  pickupPoints:string|null; itinerary:string|null; operators:string|null; reservationCount:number; }

export default function DomainOperationsPage({ operationType }: { operationType: Kind }) {
  const gemi = operationType === 'CRUISE';
  const { data, isPending } = useQuery({ queryKey:['operation-domain-list', operationType], queryFn:()=>customFetch<{rows:Row[]}>(`/api/operations/domain/${operationType}`) });
  const detail = (id:number) => gemi ? `/operations/gemi/${id}` : `/operations/sejour/${id}`;
  return <AppShell title={gemi ? 'Gemi Operasyonları' : 'Sejour Operasyonları'}>
    <div className="border rounded-lg overflow-x-auto bg-card"><Table><TableHeader><TableRow>
      <TableHead>Operasyon</TableHead><TableHead>Tarih</TableHead><TableHead>Durum</TableHead><TableHead>Rezervasyon</TableHead>
      {gemi ? <><TableHead>Gemi / Cruise</TableHead><TableHead>Liman</TableHead><TableHead>Varış / Kalkış</TableHead><TableHead>Alış</TableHead></>
        : <><TableHead>Süre</TableHead><TableHead>Program / Servis</TableHead><TableHead>Alış noktaları</TableHead><TableHead>Operatör</TableHead></>}
    </TableRow></TableHeader><TableBody>
      {isPending ? <TableRow><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow> : (data?.rows ?? []).map(row => <TableRow key={row.id}>
        <TableCell><Link className="underline" href={detail(row.id)}>OP-{row.id}</Link></TableCell><TableCell>{formatDate(row.startDate)}</TableCell>
        <TableCell>{OPERATION_STATUS_LABELS[row.status] ?? row.status}</TableCell><TableCell>{row.reservationCount}</TableCell>
        {gemi ? <><TableCell>{[row.shipName,row.cruiseLine].filter(Boolean).join(' / ') || 'Belirtilmemiş'}</TableCell><TableCell>{row.portName ?? 'Belirtilmemiş'}</TableCell><TableCell>{[row.arrivalTime,row.departureTime].filter(Boolean).join(' / ') || 'Belirtilmemiş'}</TableCell><TableCell>{[row.pickupTime,row.pickupPoints].filter(Boolean).join(' · ') || 'Belirtilmemiş'}</TableCell></>
          : <><TableCell>{[formatDate(row.startDate),formatDate(row.endDate)].filter(Boolean).join(' – ')}</TableCell><TableCell>{row.itinerary ?? row.tourName ?? 'Belirtilmemiş'}</TableCell><TableCell>{row.pickupPoints ?? 'Belirtilmemiş'}</TableCell><TableCell>{row.operators ?? 'Belirtilmemiş'}</TableCell></>}
      </TableRow>)}
    </TableBody></Table></div>
  </AppShell>;
}
