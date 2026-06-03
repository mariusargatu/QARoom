import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { buildGatewayApp } from './app'
import { createContentClient } from './content-client'

const contentBaseUrl = process.env.CONTENT_BASE_URL ?? 'http://localhost:8081'
const port = Number(process.env.PORT ?? 8080)

runServer(
  () =>
    buildGatewayApp({ content: createContentClient(contentBaseUrl), ...createProductionDeps() }),
  { port, name: 'gateway' },
)
