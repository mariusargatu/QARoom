import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useWebhooks } from '../../../hooks/useWebhooks'
import { Button } from '../../atoms/Button'
import { ErrorState } from '../../molecules/ErrorState'
import { DeliveryList } from '../../organisms/DeliveryList'
import { WebhookForm } from '../../organisms/WebhookForm'
import { WebhookList } from '../../organisms/WebhookList'

/** Page: outbound webhook subscriptions — register, manage lifecycle, inspect deliveries. */
export function WebhooksPage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const w = useWebhooks(api, communityId)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-2xl font-medium text-text">Webhooks</h1>

      {w.lastSecret ? (
        <div className="border border-warning bg-warning/10 p-4">
          <p className="text-sm font-semibold text-warning">Signing secret — copy it now</p>
          <p className="mt-1 break-all text-xs text-text">{w.lastSecret.secret}</p>
          <p className="mt-1 text-xs text-muted">QARoom never shows this again.</p>
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="border-b border-border pb-2 font-display text-lg font-medium text-text">
          Register a webhook
        </h2>
        <WebhookForm
          pending={w.busyId === 'new'}
          error={w.createError}
          onSubmit={(body) => void w.create(body)}
        />
      </section>

      {w.actionError ? (
        <p role="alert" className="text-sm text-danger">
          {w.actionError}
        </p>
      ) : null}

      {w.error ? (
        <ErrorState message={w.error} onRetry={() => void w.refresh()} />
      ) : (
        <WebhookList
          webhooks={w.webhooks}
          loading={w.loading}
          busyId={w.busyId}
          onPause={(id) => void w.pause(id)}
          onResume={(id) => void w.resume(id)}
          onDelete={(id) => void w.remove(id)}
          onViewDeliveries={(id) => void w.openDeliveries(id)}
        />
      )}

      {w.deliveries ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="font-display text-lg font-medium text-text">Deliveries</h2>
            <Button variant="ghost" onClick={w.closeDeliveries}>
              Close
            </Button>
          </div>
          <DeliveryList deliveries={w.deliveries.items} loading={w.deliveries.loading} />
        </section>
      ) : null}
    </div>
  )
}
