import { writeDoc } from '@qaroom/service-kit'
import { donationsAsyncApiYaml } from './asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', donationsAsyncApiYaml)
