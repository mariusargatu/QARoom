import { writeDoc } from '@qaroom/service-kit'
import { donationsOpenApiYaml } from './openapi-document'

writeDoc(import.meta.dirname, 'openapi', donationsOpenApiYaml)
