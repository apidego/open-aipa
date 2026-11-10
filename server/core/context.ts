import type { Config } from './config.js';
import type { Store } from './db.js';
import type { Vault } from './security.js';
export interface Context {
  config: Config;
  store: Store;
  vault: Vault;
}
