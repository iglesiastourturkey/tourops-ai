import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@workspace/api-client-react';
import { getListNotificationsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Bell, CheckCheck, Circle } from 'lucide-react';
import { formatDate } from '@/lib/labels';

export default function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: notifications, isLoading } = useListNotifications();
  const markReadMutation = useMarkNotificationRead();
  const markAllMutation = useMarkAllNotificationsRead();

  const all = notifications ?? [];
  const unread = all.filter(n => !n.isRead);

  function handleMarkRead(id: number) {
    markReadMutation.mutate({ id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    });
  }

  function handleMarkAll() {
    markAllMutation.mutate(undefined, {
      onSuccess: () => { toast({ title: 'Tüm bildirimler okundu olarak işaretlendi' }); qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); },
    });
  }

  const NotifList = ({ items }: { items: typeof all }) => (
    <div className="space-y-2">
      {items.length === 0 ? (
        <div className="text-center text-muted-foreground py-16 flex flex-col items-center gap-3">
          <Bell className="w-10 h-10 opacity-30" />
          <p>Bildirim bulunmuyor</p>
        </div>
      ) : items.map(n => (
        <div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${n.isRead ? 'bg-card border-border' : 'bg-accent/30 border-primary/20'}`} data-testid={`notification-${n.id}`}>
          <div className="mt-1 flex-shrink-0">
            {n.isRead ? <Circle className="w-3.5 h-3.5 text-muted-foreground" /> : <Circle className="w-3.5 h-3.5 fill-primary text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${n.isRead ? 'text-foreground' : 'font-medium text-foreground'}`}>{n.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatDate(n.createdAt)}</p>
          </div>
          {!n.isRead && (
            <Button size="sm" variant="ghost" className="text-xs h-7 flex-shrink-0" onClick={() => handleMarkRead(n.id)} data-testid={`button-mark-read-${n.id}`}>
              Okundu
            </Button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <AppShell title="Bildirimler">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{unread.length} okunmamış bildirim</p>
        {unread.length > 0 && (
          <Button variant="outline" size="sm" className="gap-2" onClick={handleMarkAll} disabled={markAllMutation.isPending} data-testid="button-mark-all-read">
            <CheckCheck className="w-4 h-4" /> Tümünü Okundu İşaretle
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : (
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all" data-testid="tab-all-notifications">Tümü ({all.length})</TabsTrigger>
            <TabsTrigger value="unread" data-testid="tab-unread-notifications">Okunmamış ({unread.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="all"><NotifList items={all} /></TabsContent>
          <TabsContent value="unread"><NotifList items={unread} /></TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}
