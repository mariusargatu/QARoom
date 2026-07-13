import { writeDoc } from '@qaroom/service-kit'
import { identityOpenApiYaml } from './contract/openapi-document'

writeDoc(import.meta.dirname, 'openapi', identityOpenApiYaml)
