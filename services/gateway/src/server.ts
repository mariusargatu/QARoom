import { connectNats } from '@qaroom/messaging'
import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { buildGatewayApp } from './app'
import { createContentClient } from './content-client'
import { startWsFeed } from './event-consumer'
import { CommunityEventStream } from './event-stream'
import { createTicketClient } from './ticket-client'

const contentBaseUrl = process.env.CONTENT_BASE_URL ?? 'http://localhost:8081'
const identityBaseUrl = process.env.IDENTITY_BASE_URL ?? 'http://localhost:8082'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = Number(process.env.PORT ?? 8080)

runServer(
  async () => {
    const eventStream = new CommunityEventStream()
    // Feed the WS/poll stream from JetStream flag/donation events (integration surface).
    const nats = await connectNats(natsUrl)
    await startWsFeed(nats, eventStream)
    return buildGatewayApp({
      content: createContentClient(contentBaseUrl),
      tickets: createTicketClient(identityBaseUrl),
      eventStream,
      ...createProductionDeps(),
    })
  },
  { port, name: 'gateway' },
)
