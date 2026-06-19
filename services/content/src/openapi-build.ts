import { writeDoc } from '@qaroom/service-kit'
import { contentOpenApiYaml } from './contract/openapi-document'

writeDoc(import.meta.dirname, 'openapi', contentOpenApiYaml)
