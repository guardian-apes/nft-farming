import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  defaultFarmConfig,
  defaultFixedConfig,
  defaultVariableConfig,
  GemFarmTester,
} from '../gem-farm.tester';
import { BN } from '@project-serum/anchor';
import {
  FixedRateConfig,
  RewardType,
  VariableRateConfig,
} from '../gem-farm.client';
import { PublicKey } from '@solana/web3.js';

chai.use(chaiAsPromised);

const fastConfig = <VariableRateConfig>{
  amount: new BN(10000),
  durationSec: new BN(2),
};

const creator = new PublicKey('75ErM1QcGjHiPMX7oLsf9meQdGSUs4ZrwS2X8tBpsZhA');

describe('deposit into whitelisted farms', () => {
  let gf = new GemFarmTester();

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
  });

  it('whitelists a creator', async () => {
    const { whitelistProof, farm } = await gf.callWhitelistCreator(creator)

    const farmAccount = await gf.farmProgram.account.farm.fetch(farm)
    const proofAccount = await gf.farmProgram.account.whitelistProof.fetch(whitelistProof)

    assert.equal(farmAccount.whitelistedCreators, 1)
    assert.equal(proofAccount.farm.toBase58(), farm.toBase58())
    assert.equal(proofAccount.whitelistedAddress.toBase58(), creator.toBase58())
  });
});
