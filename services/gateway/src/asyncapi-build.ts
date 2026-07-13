import { writeDoc } from '@qaroom/service-kit'
import { gatewayAsyncApiYaml } from './contract/asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', gatewayAsyncApiYaml)
