import { writeDoc } from '@qaroom/service-kit'
import { donationsOpenApiYaml } from './contract/openapi-document'

writeDoc(import.meta.dirname, 'openapi', donationsOpenApiYaml)
