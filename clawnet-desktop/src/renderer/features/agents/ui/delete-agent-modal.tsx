import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteAgent } from '../hooks/use-agent-mutations';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';

interface Props {
  agentId: string | null;
  agentName: string;
  onClose: () => void;
}

export function DeleteAgentModal({ agentId, agentName, onClose }: Props) {
  const { t } = useTranslation('agent');
  const del = useDeleteAgent();
  const [pending, setPending] = useState(false);

  const confirm = () => {
    if (!agentId) return;
    setPending(true);
    del.mutate(agentId, {
      onSuccess: () => { setPending(false); onClose(); },
      onError: () => {
        setPending(false);
        toastStore.getState().push({ message: t('wizard.deleteFailed'), level: 'error' });
      },
    });
  };

  return (
    <Sheet open={agentId !== null} onClose={onClose} size="sm" testId="delete-agent-modal">
      <SheetHeader onClose={onClose}>{t('wizard.delete')}</SheetHeader>
      <SheetBody>
        <div style={{ fontSize: 13 }}>{t('wizard.deleteConfirm', { name: agentName })}</div>
      </SheetBody>
      <SheetFooter>
        <Button size="sm" variant="ghost" type="button" onClick={onClose}>
          {t('wizard.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="button" onClick={confirm} disabled={pending}>
          {t('wizard.delete')}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
