import { PublicKey } from '@solana/web3.js';

export const DEFAULTS = {
  CLUSTER: 'devnet',
  //todo these need to be PER cluster
  GEM_BANK_PROG_ID: new PublicKey(
    '7KRu52tpJ4hb9qdk4FsBMrWaZxkWt49o6kbW7QMrutc8'
  ),
  GEM_FARM_PROG_ID: new PublicKey(
    '38yr6ZVQecngTXbad8pj4nbbGdudDHfgfpD6xQJAJG1c'
  ),
};
