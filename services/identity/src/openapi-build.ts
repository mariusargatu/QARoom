import { writeDoc } from '@qaroom/service-kit'
import { identityOpenApiYaml } from './openapi-document'

writeDoc(import.meta.dirname, 'openapi', identityOpenApiYaml)
