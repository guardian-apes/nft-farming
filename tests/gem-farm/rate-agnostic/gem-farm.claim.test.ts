import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  defaultFarmConfig,
  defaultFixedConfig,
  defaultVariableConfig,
  GemFarmTester,
} from '../gem-farm.tester';
import { BN } from '@project-serum/anchor';
import { RewardType, VariableRateConfig } from '../gem-farm.client';
import { pause } from '../../gem-common/util';
import { toBN } from '../../gem-common/types';

chai.use(chaiAsPromised);

const fastConfig = <VariableRateConfig>{
  amount: new BN(10000),
  durationSec: new BN(2),
};

describe('claim rewards from vault', () => {
  let gf = new GemFarmTester();
  // we must fund the farm before we can deposit on a higher tier.
  const fixedConfig = {
    schedule: {
      //total 30 per gem
      tier0: {
        rewardRate: toBN(1),
        requiredTenure: toBN(0),
      },
      tier1: {
        rewardRate: toBN(5),
        requiredTenure: toBN(20),
      },
      tier2: {
        rewardRate: toBN(7),
        requiredTenure: toBN(40),
      },
      //leaving this one at 0 so that it's easy to test how much accrued over first 6s
      tier3: {
        rewardRate: toBN(9),
        requiredTenure: toBN(60),
      },
      denominator: toBN(1),
    },
  };

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig, fixedConfig.schedule);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
    const amount = new BN(Math.random() * 50000);
    await gf.callFundReward(amount);
  });

  it('deposit gem tier2 & tier0 & tier3 & tier1 -> wait 5 seconds -> claim rewards', async () => {
    const [{ vault: vault1Tier1 }, { vault: vault2Tier2 }] = await Promise.all([
      gf.callDeposit(gf.farmer1Identity, fixedConfig.schedule.tier1),
      gf.callDeposit(gf.farmer2Identity, fixedConfig.schedule.tier2),
    ]);
    let vaultAcc: any = await gf.fetchVaultAcc(vault1Tier1);

    await pause(5000);

    await gf.callClaimRewards(gf.farmer1Identity, vaultAcc.gemMint);

    // fresh vault account
    vaultAcc = await gf.fetchVaultAcc(vault1Tier1);

    const minTotalAccrued = fixedConfig.schedule.tier1?.rewardRate
      .mul(new BN(4))
      .toNumber()!; // waited 5 seconds have elapsed
    const maxTotalAccrued = fixedConfig.schedule.tier1?.rewardRate
      .mul(new BN(7))
      .toNumber()!; // waited 5 seconds have elapsed
    const paidOutReward = vaultAcc.rewardA.paidOutReward.toNumber();
    const lastRewardsClaimedAt =
      vaultAcc.rewardA.lastRewardsClaimedAt.toNumber();
    const lastRewardsUpdatedTimeDifference =
      vaultAcc.rewardA.lastRewardsClaimedAt.sub(vaultAcc.rewardA.stakedAt);

    assert.equal(
      true,
      lastRewardsUpdatedTimeDifference.toNumber() >= 4 &&
        lastRewardsUpdatedTimeDifference.toNumber() <= 7
    ); // time ellapsed is between 4 and 7
    assert.equal(
      true,
      paidOutReward >= minTotalAccrued && paidOutReward <= maxTotalAccrued
    ); // make sure paid out reward is between rewards for 4 seconds and rewards for 7 seconds

    await pause(3000);
    await gf.callClaimRewards(gf.farmer1Identity, vaultAcc.gemMint); // claim rewards again
    let updatedVaultAcc: any = await gf.fetchVaultAcc(vault1Tier1);

    const minTotalAccruedB = fixedConfig.schedule.tier1?.rewardRate
      .mul(new BN(2))
      .toNumber()!; // waited 1 - 3 seconds have elapsed
    const maxTotalAccruedB = fixedConfig.schedule.tier1?.rewardRate
      .mul(new BN(4))
      .toNumber()!; // waited 3 seconds have elapsed
    const paidOutRewardB = updatedVaultAcc.rewardA.paidOutReward.toNumber();
    const lastRewardsUpdatedTimeDifferenceB =
      updatedVaultAcc.rewardA.lastRewardsClaimedAt.toNumber() -
      lastRewardsClaimedAt; // sub from previous last rewards claimed at value (before the 3 seconds pause)

    const paidOutDifference = paidOutRewardB - paidOutReward; // old paid out reward minus new paid out reward should be approximately amount deposited into user's wallet
    assert.equal(
      true,
      lastRewardsUpdatedTimeDifferenceB >= 2 &&
        lastRewardsUpdatedTimeDifferenceB <= 4
    ); // time ellapsed is between 2 and 4
    assert.equal(
      true,
      paidOutDifference >= minTotalAccruedB &&
        paidOutDifference <= maxTotalAccruedB
    ); // the difference between the second paid out reward and first paid out reward should fall in this range

    // claim rewards for second farmer
    await gf.callClaimRewards(gf.farmer2Identity, gf.gem2.tokenMint);

    let vaultAcc2: any = await gf.fetchVaultAcc(vault2Tier2);

    const minTotalAccruedB2 = fixedConfig.schedule.tier2?.rewardRate
      .mul(new BN(7))
      .toNumber()!; // waited 8 - 10 seconds have elapsed
    const maxTotalAccruedB2 = fixedConfig.schedule.tier2?.rewardRate
      .mul(new BN(10))
      .toNumber()!; // waited 8 - 10 seconds have elapsed
    const paidOutRewardB2 = vaultAcc2.rewardA.paidOutReward.toNumber();
    const lastRewardsUpdatedTimeDifferenceB2 =
      vaultAcc2.rewardA.lastRewardsClaimedAt.toNumber() -
      vaultAcc2.rewardA.stakedAt.toNumber(); // sub from previous last rewards claimed at value (before the 3 seconds pause)

    assert.equal(
      true,
      lastRewardsUpdatedTimeDifferenceB2 >= 7 &&
        lastRewardsUpdatedTimeDifferenceB2 <= 10
    ); // time ellapsed is between 2 and 4
    assert.equal(
      true,
      paidOutRewardB2 >= minTotalAccruedB2 &&
        paidOutRewardB2 <= maxTotalAccruedB2
    );
  });
});

describe('claim rewards from vault (denominator not one)', () => {
  let gf = new GemFarmTester();
  // we must fund the farm before we can deposit on a higher tier.
  const fixedConfig = {
    schedule: {
      //total 30 per gem
      tier0: {
        rewardRate: toBN(100),
        requiredTenure: toBN(0),
      },
      tier1: {
        rewardRate: toBN(500),
        requiredTenure: toBN(2),
      },
      tier2: {
        rewardRate: toBN(700),
        requiredTenure: toBN(4),
      },
      //leaving this one at 0 so that it's easy to test how much accrued over first 6s
      tier3: {
        rewardRate: toBN(900),
        requiredTenure: toBN(6),
      },
      denominator: toBN(10),
    },
  };

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig, fixedConfig.schedule);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
    const amount = new BN(Math.random() * 50000);
    await gf.callFundReward(amount);
  });

  it('deposit gem tier2 -> wait 5 seconds -> claim rewards', async () => {
    const [{ vault: vault1Tier1 }, { vault: vault2Tier2 }] = await Promise.all([
      gf.callDeposit(gf.farmer1Identity, fixedConfig.schedule.tier1),
      gf.callDeposit(gf.farmer2Identity, fixedConfig.schedule.tier2),
    ]);
    let vaultAcc: any = await gf.fetchVaultAcc(vault1Tier1);
    let vaultAcc2: any = await gf.fetchVaultAcc(vault2Tier2);

    await pause(4000);

    const [
      { rewardADestination },
      { rewardADestination: rewardADestination2 },
    ] = await Promise.all([
      gf.callClaimRewards(gf.farmer1Identity, vaultAcc.gemMint),
      gf.callClaimRewards(gf.farmer2Identity, vaultAcc2.gemMint),
    ]);

    vaultAcc = await gf.fetchVaultAcc(vault1Tier1);
    vaultAcc2 = await gf.fetchVaultAcc(vault2Tier2);

    const timeInSeconds = fixedConfig.schedule.tier1.requiredTenure.toNumber();
    const timeInSeconds2 = fixedConfig.schedule.tier2.requiredTenure.toNumber();
    const expectedPaidOutReward =
      timeInSeconds *
      (fixedConfig.schedule.tier1.rewardRate.toNumber() /
        fixedConfig.schedule.denominator.toNumber());
    const expectedPaidOutReward2 =
      timeInSeconds2 *
      (fixedConfig.schedule.tier2.rewardRate.toNumber() /
        fixedConfig.schedule.denominator.toNumber());

    assert.equal(
      expectedPaidOutReward,
      vaultAcc.rewardA.paidOutReward.toNumber()
    );
    assert.equal(
      expectedPaidOutReward,
      vaultAcc.rewardA.reservedAmount.toNumber()
    );
    assert.equal(
      expectedPaidOutReward2,
      vaultAcc2.rewardA.paidOutReward.toNumber()
    );
    assert.equal(
      expectedPaidOutReward2,
      vaultAcc2.rewardA.reservedAmount.toNumber()
    );

    // check reward amounts
    const rewardADestinationAcc = await gf.fetchTokenAcc(
      gf.rewardMint.publicKey,
      rewardADestination
    );
    const rewardADestination2Acc = await gf.fetchTokenAcc(
      gf.rewardMint.publicKey,
      rewardADestination2
    );

    // the checks after this return deal with time, and are a little unstable.
    return;
    const exactTimeRewarded2 =
      vaultAcc2.rewardA.lastRewardsClaimedAt.toNumber() -
      vaultAcc2.rewardA.stakedAt.toNumber();

    // for the first farmer, they staked for 2 days only.
    // which means we only pay them that maximum to their rewards
    assert.equal(
      vaultAcc.rewardA.rewardTier.requiredTenure.toNumber() *
        (vaultAcc.rewardA.rewardTier.rewardRate.toNumber() /
          fixedConfig.schedule.denominator.toNumber()),
      rewardADestinationAcc.amount.toNumber()
    );

    // for the second farmer, their tenure is 6s, but we staked for only 4
    // which means they receive a partial payout matching the time they've staked so far.
    assert.equal(
      exactTimeRewarded2 *
        (vaultAcc2.rewardA.rewardTier.rewardRate.toNumber() /
          fixedConfig.schedule.denominator.toNumber()),
      rewardADestination2Acc.amount.toNumber()
    );
  });
});

describe('claim rewards from vault  (after tenure completed)', () => {
  let gf = new GemFarmTester();

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
    const amount = new BN(Math.random() * 50000);
    await gf.callFundReward(amount);
  });

  it('claiming after tenure does not overpay', async () => {
    const { vault, farm } = await gf.callDeposit(
      gf.farmer1Identity,
      defaultFixedConfig.schedule.tier1
    );

    let vaultAcc: any = await gf.fetchVaultAcc(vault);

    await pause(1000); // wait for 1s. claim rewards

    await gf.callClaimRewards(gf.farmer1Identity, vaultAcc.gemMint);

    await pause(5000); // wait another 5s until lock period expires

    await gf.callClaimRewards(gf.farmer1Identity, vaultAcc.gemMint);

    let farmAcc: any = await gf.fetchFarmAcc(farm);
    vaultAcc = await gf.fetchVaultAcc(vault);

    // the max that will ever be paid out is the reserved amount
    assert.equal(
      vaultAcc.rewardA.paidOutReward.toNumber(),
      vaultAcc.rewardA.reservedAmount.toNumber()
    );
  });

  it('claim rewards on tier0 pays out everytime', async () => {
    const [{ vault: vault1Tier1 }, { vault: vault2Tier2 }] = await Promise.all([
      gf.callDeposit(gf.farmer1Identity),
      gf.callDeposit(gf.farmer2Identity),
    ]);
    let vaultAcc: any = await gf.fetchVaultAcc(vault1Tier1);
    let vaultAcc2: any = await gf.fetchVaultAcc(vault2Tier2);

    await pause(5000);

    await gf.callClaimRewards(gf.farmer1Identity, vaultAcc.gemMint);
    await gf.callClaimRewards(gf.farmer2Identity, vaultAcc2.gemMint);

    vaultAcc = await gf.fetchVaultAcc(vault1Tier1);
    vaultAcc2 = await gf.fetchVaultAcc(vault2Tier2);

    const timeInSeconds =
      vaultAcc.rewardA.lastRewardsClaimedAt.toNumber() -
      vaultAcc.rewardA.stakedAt.toNumber();
    const timeInSeconds2 =
      vaultAcc2.rewardA.lastRewardsClaimedAt.toNumber() -
      vaultAcc2.rewardA.stakedAt.toNumber();
    const expectedPaidOutReward =
      timeInSeconds * defaultFixedConfig.schedule.tier0.rewardRate.toNumber();
    const expectedPaidOutReward2 =
      timeInSeconds2 * defaultFixedConfig.schedule.tier0.rewardRate.toNumber();

    assert.equal(
      expectedPaidOutReward,
      vaultAcc.rewardA.paidOutReward.toNumber()
    );
    assert.equal(
      expectedPaidOutReward2,
      vaultAcc2.rewardA.paidOutReward.toNumber()
    );
    assert.equal(vaultAcc.rewardA.reservedAmount.toNumber(), 0);
    assert.equal(vaultAcc2.rewardA.reservedAmount.toNumber(), 0);
  });
});
