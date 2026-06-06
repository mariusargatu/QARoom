import { writeDoc } from '@qaroom/service-kit'
import { flagsOpenApiYaml } from './openapi-document'

writeDoc(import.meta.dirname, 'openapi', flagsOpenApiYaml)
