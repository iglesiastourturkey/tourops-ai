import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useListOperations } from '@workspace/api-client-react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, formatDate } from '@/lib/labels';

export default function OperationsPage() {
  const { data: operations, isLoading, isError, refetch } = useListOperations();

  return (
    <AppShell title="Operasyonlar">
      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead className="hidden md:table-cell">Başlangıç</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Tamamlanma</TableHead>
              <TableHead className="w-16">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-destructive text-sm">Veriler yüklenemedi.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => refetch()}
                      data-testid="button-retry-operations"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Yeniden Dene
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : !operations || operations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  Operasyon bulunamadı
                </TableCell>
              </TableRow>
            ) : (
              operations.map(op => (
                <TableRow key={op.id} data-testid={`row-operation-${op.id}`}>
                  <TableCell className="font-mono text-sm font-medium">OP-{op.id}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {formatDate(op.startDate)}
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OPERATION_STATUS_COLORS[op.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {OPERATION_STATUS_LABELS[op.status] ?? op.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={op.completionRate} className="h-1.5 w-20" />
                      <span className="text-xs text-muted-foreground">%{Math.round(op.completionRate)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/operations/${op.id}`}>
                      <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-view-operation-${op.id}`}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
