/* @dpdm-ignore */
import './cycle-b';

// @dpdm-ignore
const dep = require('../../shared/src/dep');

/* @dpdm-ignore */
export * from '../../ui/src';

export async function load() {
  // @dpdm-ignore
  return import('../../ui/src');
}

export const value = dep;
