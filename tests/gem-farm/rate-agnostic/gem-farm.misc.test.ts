import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  defaultFarmConfig,
  defaultFixedConfig,
  GemFarmTester,
} from '../gem-farm.tester';
import { BN } from '@project-serum/anchor';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { FarmConfig, RewardType } from '../gem-farm.client';
import { WhitelistType } from '../../gem-bank/gem-bank.client';

chai.use(chaiAsPromised);

const updatedFarmConfig = <FarmConfig>{
  minStakingPeriodSec: new BN(0),
  cooldownPeriodSec: new BN(0),
  unstakingFeeLamp: new BN(LAMPORTS_PER_SOL / 2),
};

const creator = new PublicKey('75ErM1QcGjHiPMX7oLsf9meQdGSUs4ZrwS2X8tBpsZhA');

describe('misc', () => {
  let gf = new GemFarmTester();

  before('preps accs', async () => {
    await gf.prepAccounts(45000);
  });

  it('inits the farm', async () => {
    await gf.callInitFarm(defaultFarmConfig, RewardType.Fixed);

    const farmAcc = (await gf.fetchFarm()) as any;

    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier1.rewardRate.toNumber(), defaultFixedConfig.schedule.tier1?.rewardRate)
    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier2.rewardRate.toNumber(), defaultFixedConfig.schedule.tier2?.rewardRate)
    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier3.rewardRate.toNumber(), defaultFixedConfig.schedule.tier3?.rewardRate)

    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier1.requiredTenure.toNumber(), defaultFixedConfig.schedule.tier1?.requiredTenure)
    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier2.requiredTenure.toNumber(), defaultFixedConfig.schedule.tier2?.requiredTenure)
    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier3.requiredTenure.toNumber(), defaultFixedConfig.schedule.tier3?.requiredTenure)

    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier0.rewardRate.toNumber(), 1)
    assert.equal(farmAcc?.rewardA?.fixedRate.schedule.tier0.requiredTenure.toNumber(), 0)
  
    assert.equal(
      farmAcc[gf.reward].rewardMint.toBase58(),
      gf.rewardMint.publicKey.toBase58()
    );
  });

  it('authorizes funder', async () => {
    const { authorizationProof } = await gf.callAuthorize();

    const authorizationProofAcc = await gf.fetchAuthorizationProofAcc(
      authorizationProof
    );
    assert.equal(
      authorizationProofAcc.authorizedFunder.toBase58,
      gf.funder.publicKey.toBase58
    );

    // testing idempotency - should NOT throw an error
    await gf.callAuthorize();
  });
});
