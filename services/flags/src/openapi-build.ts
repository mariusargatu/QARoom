import { writeDoc } from '@qaroom/service-kit'
import { flagsOpenApiYaml } from './contract/openapi-document'

writeDoc(import.meta.dirname, 'openapi', flagsOpenApiYaml)
