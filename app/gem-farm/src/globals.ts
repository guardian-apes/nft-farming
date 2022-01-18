import { PublicKey } from '@solana/web3.js';

export const DEFAULTS = {
  CLUSTER: 'devnet',
  //todo these need to be PER cluster
  GEM_BANK_PROG_ID: new PublicKey(
    'AWiJ4S4ApGCZiVqi6K93aTxgzg9U6g2mEmPugJDM3fgZ'
  ),
  GEM_FARM_PROG_ID: new PublicKey(
    'DzRXhhpFKwJ8K6GjQjqLcxF9nxF1p8cDsxjsFWhYYJwV'
  ),
};
