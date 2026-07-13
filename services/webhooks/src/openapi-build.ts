import { writeDoc } from '@qaroom/service-kit'
import { webhooksOpenApiYaml } from './contract/openapi-document'

writeDoc(import.meta.dirname, 'openapi', webhooksOpenApiYaml)
