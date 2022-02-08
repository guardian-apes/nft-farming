import { BN } from '@project-serum/anchor';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  defaultFarmConfig,
  defaultFixedConfig,
  GemFarmTester,
} from '../gem-farm.tester';

chai.use(chaiAsPromised);

const creator = new PublicKey('75ErM1QcGjHiPMX7oLsf9meQdGSUs4ZrwS2X8tBpsZhA');

describe('misc', () => {
  let gf = new GemFarmTester();

  before('preps accs', async () => {
    await gf.prepAccounts(45000);
  });

  it('inits the farm', async () => {
    await gf.callInitFarm(defaultFarmConfig);

    const farmAcc = (await gf.fetchFarm()) as any;

    assert.equal(farmAcc.config.whitelistedCandyMachine, null)
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

  it('inits the farm with whitelisted candy machine -> updates farm to no whitelisted candy machine -> update paper hands tax to 0 SOL', async () => {
    await gf.callInitSecondFarm({
      paperHandsTaxLamp: new BN(2).mul(new BN(LAMPORTS_PER_SOL)),
      whitelistedCandyMachine: creator
    });

    const farmAcc = (await gf.fetchFarm2()) as any;

    assert.equal(farmAcc.config.whitelistedCandyMachine.toBase58(), creator.toBase58())

    assert.equal(farmAcc.config.whitelistedCandyMachine.toBase58(), creator.toBase58())
    assert.equal(farmAcc.config.paperHandsTaxLamp.toNumber(), 2000000000) // 2 billion lamports (2 sol)

    await gf.callUpdateFarm2({
      paperHandsTaxLamp: new BN(0),
      whitelistedCandyMachine: undefined
    })

    const updatedFarmAccount = (await gf.fetchFarm2()) as any;

    assert.equal(updatedFarmAccount.config.whitelistedCandyMachine, null)
    assert.equal(updatedFarmAccount.config.paperHandsTaxLamp.toNumber(), 0) // 0 lamports (0 SOL)
  });
});
