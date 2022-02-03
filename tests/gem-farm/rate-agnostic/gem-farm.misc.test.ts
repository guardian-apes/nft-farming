import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  defaultFarmConfig,
  defaultFixedConfig,
  GemFarmTester,
} from '../gem-farm.tester';

chai.use(chaiAsPromised);

describe('misc', () => {
  let gf = new GemFarmTester();

  before('preps accs', async () => {
    await gf.prepAccounts(45000);
  });

  it('inits the farm', async () => {
    await gf.callInitFarm(defaultFarmConfig);

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
});
