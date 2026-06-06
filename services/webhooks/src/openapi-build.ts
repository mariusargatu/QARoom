import { writeDoc } from '@qaroom/service-kit'
import { webhooksOpenApiYaml } from './openapi-document'

writeDoc(import.meta.dirname, 'openapi', webhooksOpenApiYaml)
