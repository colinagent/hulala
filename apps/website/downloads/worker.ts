import catalog from './catalog.json'
import { createGateway } from './gateway'
export { DownloadQuota } from './quota'
export default createGateway(catalog)
