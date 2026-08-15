import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type CommunicationWorkflowStatus =
  | 'not_connected'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'pending_approval';

export interface CommunicationWorkflowSummary {
  key: 'whatsapp-tour-sales' | 'ai-remarketing';
  name: string;
  status: CommunicationWorkflowStatus;
  lastEventAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  summary: string | null;
  processedCount: number;
  pendingApprovalCount: number;
  errorCount: number;
}

export interface CommunicationsStatus {
  configured: boolean;
  mode: 'disabled' | 'misconfigured' | 'migration_required' | 'readonly';
  message: string;
  totals: {
    pendingApprovals: number;
    openErrors: number;
    processed: number;
  };
  workflows: CommunicationWorkflowSummary[];
}

export function useCommunicationsStatus() {
  return useQuery({
    queryKey: ['/api/communications/status'],
    queryFn: ({ signal }) => customFetch<CommunicationsStatus>(
      '/api/communications/status',
      { method: 'GET', signal },
    ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
