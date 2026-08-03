import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { FieldShell } from '@/components/FieldShell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';

export default function OfflineQueuePage() {
  const { pending, retryAll, removeFromQueue, resendAsNew, checkServerState } = useOfflineQueue();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [serverState, setServerState] = useState<unknown>(null);

  return (
    <FieldShell title="Bekleyen İşlemler">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/field" className="text-sm text-blue-600">Saha Paneli</Link>
        <Button variant="outline" size="sm" onClick={() => void retryAll()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Uygun olanları dene
        </Button>
      </div>
      {pending.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Bekleyen işlem yok
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(action => {
            const ambiguous = action.status === 'ambiguous';
            const conflict = action.status === 'conflict';
            return (
              <div key={action.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-2">
                  {ambiguous ? <AlertTriangle className="mt-0.5 h-4 w-4 text-orange-500" /> :
                    conflict ? <AlertTriangle className="mt-0.5 h-4 w-4 text-red-500" /> :
                    action.status === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 text-red-500" /> :
                    action.status === 'sending' ? <RefreshCw className="mt-0.5 h-4 w-4 animate-spin text-blue-500" /> :
                    <Clock className="mt-0.5 h-4 w-4 text-amber-500" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{action.label}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {ambiguous ? 'Sunucu yanıtı belirsiz' : conflict ? 'Çakışma — sunucu verisi korunuyor' :
                        action.status === 'error' ? 'Hata' : action.status === 'sending' ? 'Gönderiliyor' : 'Bekliyor'}
                    </p>
                    {action.lastError && <p className="mt-1 text-xs text-red-600">{action.lastError}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(ambiguous || conflict) && (
                        <Button variant="outline" size="sm" onClick={async () => setServerState(await checkServerState(action.id))}>
                          Sunucu Durumunu Kontrol Et
                        </Button>
                      )}
                      {ambiguous && (
                        <Button size="sm" onClick={() => setConfirmId(action.id)}>
                          Yeni İşlem Olarak Yeniden Gönder
                        </Button>
                      )}
                      {!ambiguous && !conflict && action.status === 'error' && (
                        <Button variant="outline" size="sm" onClick={() => void retryAll()}>Tekrar dene</Button>
                      )}
                      {action.status === 'error' && (
                        <Button variant="ghost" size="sm" onClick={() => void removeFromQueue(action.id)}>Sil</Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {serverState !== null && (
        <Dialog open onOpenChange={() => setServerState(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Sunucu Durumu</DialogTitle></DialogHeader>
            <pre className="max-h-80 overflow-auto rounded-lg bg-gray-50 p-3 text-xs">{JSON.stringify(serverState, null, 2)}</pre>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={!!confirmId} onOpenChange={open => !open && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Yeni işlem olarak gönderilsin mi?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">Orijinal belirsiz kayıt değişmeden kalır. Yeni işlem farklı bir kimlik anahtarıyla gönderilir.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Vazgeç</Button>
            <Button onClick={async () => { if (confirmId) await resendAsNew(confirmId); setConfirmId(null); }}>Onayla</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FieldShell>
  );
}