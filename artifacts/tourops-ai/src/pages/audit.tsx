import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { API_BASE } from '@/lib/clerk-appearance';
import { Activity, Search, ChevronLeft, ChevronRight, AlertCircle, FileText, Database, ShieldAlert, RefreshCw, Eye, Users, AlertTriangle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditApiResponse {
  logs: any[];
  total: number;
  limit: number;
  offset: number;
  summary?: {
    totalEvents: number;
    errorCount: number;
    activeUsers: number;
    todayEvents: number;
    criticalChanges: number;
  };
}

interface ParsedLog {
  id: string | number;
  eventType: string;
  module: string;
  result: string;
  oldValue: any;
  newValue: any;
  metadata: any;
  createdAt: string;
  actorName: string;
  actorRole: string;
  entityType: string;
  entityId: string;
  description: string;
}

const EVENT_LABELS: Record<string, string> = {
  system_mode_changed: 'Sistem Modu',
  operation_created: 'Operasyon oluşturuldu',
  operation_updated: 'Operasyon güncellendi',
  operation_status_changed: 'Operasyon durumu değiştirildi',
  task_created: 'Görev oluşturuldu',
  task_completed: 'Görev tamamlandı',
  task_reopened: 'Görev yeniden açıldı',
  task_deleted: 'Görev silindi',
  role_changed: 'Rol değiştirildi',
  user_activated: 'Kullanıcı etkinleştirildi',
  user_deactivated: 'Kullanıcı devre dışı bırakıldı',
  invitation_sent: 'Davet gönderildi',
  permission_changed: 'Yetki değiştirildi',
  accounting_transaction_approved: 'İşlem onaylandı',
  accounting_transaction_rejected: 'İşlem reddedildi',
};

const getEventLabel = (type: string) => EVENT_LABELS[type] || type;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function customFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

function parseLogEntry(row: any): ParsedLog {
  const logData = row.log || row;
  const actorData = row.actor || row;

  let actorName = 'Sistem';
  if (actorData) {
    actorName = actorData.name || actorData.email || actorData.actorName || actorData.actorEmail || 'Sistem';
  }

  return {
    id: logData.id ?? `${logData.eventType ?? 'event'}-${logData.createdAt ?? 'unknown'}`,
    eventType: logData.eventType || 'unknown_event',
    module: logData.module || logData.metadata?.module || 'system',
    result: logData.result || logData.metadata?.result || 'success',
    oldValue: logData.oldValue,
    newValue: logData.newValue,
    metadata: logData.metadata,
    createdAt: logData.createdAt || new Date().toISOString(),
    actorName,
    actorRole: actorData?.role || logData.metadata?.actorRole || '—',
    entityType: logData.metadata?.entityType || '—',
    entityId: logData.metadata?.entityId || '—',
    description: logData.metadata?.description || '',
  };
}

const renderJson = (val: any) => {
  if (val === undefined || val === null) return <span className="text-muted-foreground italic">Yok</span>;
  if (typeof val !== 'object') return <span>{String(val)}</span>;
  return (
    <pre className="p-3 bg-muted/50 border rounded-md text-[11px] overflow-x-auto font-mono text-muted-foreground mt-1">
      {JSON.stringify(val, null, 2)}
    </pre>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const limit = 20;
  const [offset, setOffset] = useState(0);
  
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [eventType, setEventType] = useState<string>('all');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const [selectedLog, setSelectedLog] = useState<ParsedLog | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset pagination on filter changes
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, eventType, resultFilter, fromDate, toDate]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (eventType && eventType !== 'all') params.set('eventType', eventType);
    if (resultFilter && resultFilter !== 'all') params.set('result', resultFilter);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    return `${API_BASE}/audit?${params.toString()}`;
  }, [limit, offset, debouncedSearch, eventType, resultFilter, fromDate, toDate]);

  const { data, isLoading, isError, error, refetch } = useQuery<AuditApiResponse>({
    queryKey: ['audit-logs', queryUrl],
    queryFn: () => customFetch<AuditApiResponse>(queryUrl),
    staleTime: 10_000,
  });

  const parsedLogs = useMemo(() => {
    return data?.logs.map(parseLogEntry) || [];
  }, [data?.logs]);

  const totalEvents = data?.summary?.totalEvents ?? data?.total ?? 0;
  const errorCount = data?.summary?.errorCount ?? 0;
  
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  const handlePrev = () => setOffset(Math.max(0, offset - limit));
  const handleNext = () => setOffset(offset + limit);

  return (
      <AppShell title="Denetim Kayıtları">
      <div className="max-w-7xl mx-auto space-y-6">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Denetim Kayıtları</h2>
            <p className="text-muted-foreground text-sm mt-1">Sistemde gerçekleştirilen kritik işlemleri ve güvenlik olaylarını inceleyin.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="py-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="w-4 h-4" /> Bugünkü İşlemler
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{(data?.summary?.todayEvents ?? totalEvents).toLocaleString('tr-TR')}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="py-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" /> Başarısız İşlemler
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{errorCount.toLocaleString('tr-TR')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" /> Kullanıcı İşlemleri
              </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-3xl font-bold">{data?.summary?.activeUsers ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Kritik Değişiklikler
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data?.summary?.criticalChanges ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-muted/10">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="space-y-1.5 lg:col-span-2">
                <Label className="text-xs">Arama</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Kullanıcı veya veri ara..."
                    className="pl-9 h-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Olay Tipi</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Tümü" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    <SelectItem value="create">Oluşturma</SelectItem>
                    <SelectItem value="update">Güncelleme</SelectItem>
                    <SelectItem value="delete">Silme</SelectItem>
                    <SelectItem value="system_mode_changed">Sistem Modu</SelectItem>
                    <SelectItem value="auth">Kimlik Doğrulama</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sonuç</Label>
                <Select value={resultFilter} onValueChange={setResultFilter}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Tümü" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    <SelectItem value="success">Başarılı</SelectItem>
                    <SelectItem value="failure">Hatalı</SelectItem>
                    <SelectItem value="denied">Reddedildi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Başlangıç</Label>
                <Input type="date" className="h-9" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bitiş</Label>
                <Input type="date" className="h-9" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content Area */}
        {isError && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex flex-col items-center justify-center p-8 gap-3">
              <AlertCircle className="w-10 h-10 text-destructive/80" />
              <div className="text-center">
                <p className="font-medium text-destructive">Kayıtlar yüklenemedi</p>
                <p className="text-sm text-destructive/80 mt-1">{error instanceof Error ? error.message : 'Bilinmeyen bağlantı hatası.'}</p>
              </div>
              <Button variant="outline" onClick={() => refetch()} className="mt-2 border-destructive/20 hover:bg-destructive/10">
                <RefreshCw className="w-4 h-4 mr-2" /> Tekrar Dene
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading && !isError && (
          <Card>
            <div className="p-4 border-b"><Skeleton className="h-6 w-32" /></div>
            <div className="p-4 space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-4 items-center">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48 hidden sm:block" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 flex-1 hidden md:block" />
                  <Skeleton className="h-8 w-16 ml-auto" />
                </div>
              ))}
            </div>
          </Card>
        )}

        {!isLoading && !isError && parsedLogs.length === 0 && (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 gap-3 text-muted-foreground">
              <Search className="w-12 h-12 opacity-20" />
              <div className="text-center">
                <p className="font-medium text-foreground">Kayıt bulunamadı</p>
                <p className="text-sm mt-1">Seçili filtrelere uygun denetim kaydı bulunmuyor.</p>
              </div>
              {(debouncedSearch || eventType !== 'all' || resultFilter !== 'all' || fromDate || toDate) && (
                <Button 
                  variant="link" 
                  onClick={() => { setSearch(''); setEventType('all'); setResultFilter('all'); setFromDate(''); setToDate(''); }}
                  className="mt-2"
                >
                  Filtreleri Temizle
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && parsedLogs.length > 0 && (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-[160px]">Tarih</TableHead>
                   <TableHead>Kullanıcı</TableHead>
                   <TableHead className="hidden lg:table-cell">Rol</TableHead>
                   <TableHead>İşlem</TableHead>
                  <TableHead>Modül</TableHead>
                   <TableHead className="hidden xl:table-cell">Hedef kayıt</TableHead>
                  <TableHead>Sonuç</TableHead>
                  <TableHead className="w-[90px] text-right">Detay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {new Date(log.createdAt).toLocaleString('tr-TR', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                      })}
                    </TableCell>
                    <TableCell className="font-medium text-sm truncate max-w-[200px]">
                      {log.actorName}
                    </TableCell>
                     <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{log.actorRole}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs bg-background">
                        {getEventLabel(log.eventType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm capitalize text-muted-foreground">
                      {log.module}
                    </TableCell>
                     <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                       {log.entityType !== '—' ? `${log.entityType} #${log.entityId}` : '—'}
                     </TableCell>
                    <TableCell>
                      {log.result === 'success' ? (
                        <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border-emerald-200/50 shadow-none font-normal">Başarılı</Badge>
                      ) : log.result === 'failure' ? (
                        <Badge className="bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 border-rose-200/50 shadow-none font-normal">Hatalı</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-normal">{log.result}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)} className="h-8 px-2 text-xs">
                        <Eye className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" /> İncele
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground bg-muted/10">
              <div>
                Toplam <strong className="text-foreground">{data?.total || 0}</strong> kayıttan <strong className="text-foreground">{offset + 1}</strong> - <strong className="text-foreground">{Math.min(offset + limit, data?.total || 0)}</strong> arası gösteriliyor
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrev} disabled={offset === 0} className="h-8">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Önceki
                </Button>
                <Button variant="outline" size="sm" onClick={handleNext} disabled={currentPage >= totalPages} className="h-8">
                  Sonraki <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Denetim Kaydı Detayı
            </DialogTitle>
            <DialogDescription>
              Olay Kimliği: <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono text-foreground">{selectedLog?.id}</code>
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-5 mt-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-muted/30 p-4 rounded-lg border">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Tarih</span>
                  <div className="font-medium">{new Date(selectedLog.createdAt).toLocaleString('tr-TR')}</div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Kullanıcı</span>
                  <div className="font-medium truncate" title={selectedLog.actorName}>{selectedLog.actorName}</div>
                </div>
                 <div>
                   <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Rol</span>
                   <div className="font-medium truncate">{selectedLog.actorRole}</div>
                 </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Olay Tipi</span>
                  <Badge variant="outline">{getEventLabel(selectedLog.eventType)}</Badge>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Sonuç</span>
                  <Badge variant={selectedLog.result === 'success' ? 'default' : 'destructive'}>
                    {selectedLog.result === 'success' ? 'Başarılı' : selectedLog.result}
                  </Badge>
                </div>
                 <div>
                   <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Hedef kayıt</span>
                   <div className="font-medium truncate">{selectedLog.entityType !== '—' ? `${selectedLog.entityType} #${selectedLog.entityId}` : '—'}</div>
                 </div>
              </div>

              <div className="space-y-4">
                 {selectedLog.description && (
                   <div>
                     <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Açıklama</span>
                     <p className="text-sm">{selectedLog.description}</p>
                   </div>
                 )}
                {(selectedLog.oldValue !== undefined || selectedLog.newValue !== undefined) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Eski Değer</span>
                      {renderJson(selectedLog.oldValue)}
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Yeni Değer</span>
                      {renderJson(selectedLog.newValue)}
                    </div>
                  </div>
                )}
                
                {selectedLog.metadata && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Ek Veri (Metadata)</span>
                    {renderJson(selectedLog.metadata)}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
