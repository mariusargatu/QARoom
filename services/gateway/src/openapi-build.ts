import { writeDoc } from '@qaroom/service-kit'
import { gatewayOpenApiYaml } from './contract/openapi-document'

writeDoc(import.meta.dirname, 'openapi', gatewayOpenApiYaml)
