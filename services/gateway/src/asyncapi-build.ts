import { writeDoc } from '@qaroom/service-kit'
import { gatewayAsyncApiYaml } from './asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', gatewayAsyncApiYaml)
