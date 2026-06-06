import { writeDoc } from '@qaroom/service-kit'
import { gatewayOpenApiYaml } from './openapi-document'

writeDoc(import.meta.dirname, 'openapi', gatewayOpenApiYaml)
