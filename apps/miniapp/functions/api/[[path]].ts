import { type ProxyEnv, proxyToWorker } from '../../src/lib/apiProxy.js';

/**
 * Pages Function: everything under `/api/` on the app's own origin goes to the
 * Worker. Picked up by `wrangler pages deploy dist` when it is run from this
 * package's directory (where `functions/` lives). See src/lib/apiProxy.ts.
 */
export const onRequest = ({ request, env }: { request: Request; env: ProxyEnv }) =>
  proxyToWorker(request, env);
