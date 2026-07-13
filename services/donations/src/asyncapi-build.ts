import { writeDoc } from '@qaroom/service-kit'
import { donationsAsyncApiYaml } from './contract/asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', donationsAsyncApiYaml)
