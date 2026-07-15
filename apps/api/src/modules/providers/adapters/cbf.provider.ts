import type { ManualProviderPayload } from './manual.provider.js';
import { ManualProvider } from './manual.provider.js';

/**
 * CBF does not expose a stable, documented public feed for this application.
 * This adapter consumes a locally obtained official export and deliberately has
 * no URL input. When an authenticated feed is contracted, only this adapter
 * needs to change; the normalized validation and reconciliation stay identical.
 */
export class CbfProvider extends ManualProvider {
  override readonly name = 'cbf-official';
  override readonly source = 'cbf://official-export';

  constructor(payload: ManualProviderPayload) {
    super(payload);
  }
}
