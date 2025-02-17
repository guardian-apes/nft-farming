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
import { toBN } from '../../gem-common/types';

chai.use(chaiAsPromised);

const fastConfig = <VariableRateConfig>{
  amount: new BN(10000),
  durationSec: new BN(2),
};

describe('depositing gems into vault', () => {
  let gf = new GemFarmTester();

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
  });

  it('deposits gem into a vault (no funding, zero funding reserved, tier0)', async () => {
    // change from depositing into gem to depositing into gem box vault
    const { vault, farm } = await gf.callDeposit(gf.farmer1Identity);
    const { vault: vault2 } = await gf.callDeposit(gf.farmer2Identity);

    const vaultAcc: any = await gf.fetchVaultAcc(vault);
    const vault2Acc: any = await gf.fetchVaultAcc(vault2);
    const farmAcc: any = await gf.fetchFarmAcc(farm);

    // make sure farm account counts correct number of vaults
    assert.equal(farmAcc.vaultCount.toNumber(), 2);

    // make sure vault belongs to farm
    assert.equal(vaultAcc.farm.toBase58(), farm.toBase58());
    assert.equal(vault2Acc.farm.toBase58(), farm.toBase58());

    // make sure owners are vault creators
    assert.equal(
      vault2Acc.owner.toBase58(),
      gf.farmer2Identity.publicKey.toBase58()
    );
    assert.equal(
      vaultAcc.owner.toBase58(),
      gf.farmer1Identity.publicKey.toBase58()
    );

    // verify amounts
    assert.equal(
      (farmAcc.rewardA as any).funds.totalAccruedToStakers.toNumber(),
      0
    );
    assert.equal(vaultAcc.rewardA.reservedAmount.toNumber(), 0);
  });

  it('deposits gem into a vault (tier1)', async () => {
    // we must fund the farm before we can deposit on a higher tier.
    const amount = new BN(Math.random() * 10000);
    const secondAmount = new BN(Math.random() * 50000);
    const totalAmount = amount.add(secondAmount);

    // fund first account
    const { pot } = await gf.callFundReward(amount);

    let farmAcc: any = await gf.fetchFarmAcc(gf.farm.publicKey);

    await gf.verifyPotContains(pot, amount);

    assert.equal(
      (farmAcc.rewardA as any).funds.totalFunded.toNumber(),
      amount.toNumber()
    );

    // fund again with second amount
    await gf.callFundReward(secondAmount);

    await gf.verifyPotContains(pot, totalAmount);

    // update farm account
    farmAcc = await gf.fetchFarmAcc(gf.farm.publicKey);

    assert.equal(
      (farmAcc.rewardA as any).funds.totalFunded.toNumber(),
      totalAmount.toNumber()
    );

    const { vault } = await gf.callDeposit(
      gf.farmer1Identity,
      defaultFixedConfig.schedule.tier1
    );

    farmAcc = await gf.fetchFarmAcc(gf.farm.publicKey);

    let vaultAcc: any = await gf.fetchVaultAcc(vault);

    let totalAccruedToVault = defaultFixedConfig.schedule.tier1?.rewardRate.mul(
      defaultFixedConfig.schedule.tier1?.requiredTenure!
    );

    // confirm total number of vaults on farm updated
    assert.equal(farmAcc.vaultCount.toNumber(), 1);

    // the amount reserved should match the tier
    assert.equal(
      vaultAcc.rewardA.reservedAmount.toNumber(),
      totalAccruedToVault?.toNumber(),
      'The reserved amount on vault is incorrect.'
    );
    // reward tier must be saved on vault
    assert.equal(
      vaultAcc.rewardA.rewardTier.rewardRate.toNumber(),
      defaultFixedConfig.schedule.tier1?.rewardRate.toNumber(),
      'The reward rate on vault is incorrect.'
    );
    assert.equal(
      vaultAcc.rewardA.rewardTier.requiredTenure.toNumber(),
      defaultFixedConfig.schedule.tier1?.requiredTenure.toNumber(),
      'The required tenure on vault is incorrect.'
    );

    assert.equal(
      (farmAcc.rewardA as any).funds.totalAccruedToStakers.toNumber(),
      totalAccruedToVault?.toNumber(),
      'The total accrued to stakers on farm is incorrect.'
    );

    // deposit another gem
    const { vault: secondVault } = await gf.callDeposit(
      gf.farmer2Identity,
      defaultFixedConfig.schedule.tier2
    );

    const totalAccruedToSecondVault =
      defaultFixedConfig.schedule.tier2?.rewardRate.mul(
        defaultFixedConfig.schedule.tier2.requiredTenure
      );

    const totalAccruedOnFarm = totalAccruedToSecondVault?.add(
      totalAccruedToVault!
    );

    let secondVaultAcc: any = await gf.fetchVaultAcc(secondVault);
    farmAcc = await gf.fetchFarmAcc(gf.farm.publicKey);

    // verify total accrued on farm
    assert.equal(
      farmAcc.rewardA.funds.totalAccruedToStakers.toNumber(),
      totalAccruedOnFarm?.toNumber(),
      'The total (after two deposits) accrued to stakers on farm is incorrect.'
    );

    // verify correct tier is recorded on vault
    assert.equal(
      secondVaultAcc.rewardA.rewardTier.rewardRate.toNumber(),
      defaultFixedConfig.schedule.tier2?.rewardRate.toNumber(),
      'The reward rate on second deposited gem is incorrect'
    );
    assert.equal(
      secondVaultAcc.rewardA.rewardTier.requiredTenure.toNumber(),
      defaultFixedConfig.schedule.tier2?.requiredTenure.toNumber(),
      'The required tenure on second deposited gem is incorrect'
    );

    // verify number of staked vaults
    assert.equal(farmAcc.vaultCount.toNumber(), 2);
  });

  it('deposit into vault -> fail (no funds) -> fund reward -> deposit again -> success', async () => {
    // we must fund the farm before we can deposit on a higher tier.
    const amount = new BN(5);
    const secondAmount = new BN(Math.random() * 50000);
    const totalAmount = amount.add(secondAmount);

    // fund farm with small amount (not enough to cover even one staker)
    const { pot } = await gf.callFundReward(amount);

    let farmAcc: any = await gf.fetchFarmAcc(gf.farm.publicKey);

    await gf.verifyPotContains(pot, amount);

    assert.equal(
      (farmAcc.rewardA as any).funds.totalFunded.toNumber(),
      amount.toNumber()
    );

    // deposit with the highest tier (meaning highest reserves need to be made)
    // requires 54 tokens reserved, but we only deposited 5
    await expect(
      gf.callDeposit(gf.farmer1Identity, defaultFixedConfig.schedule.tier3)
    ).to.be.rejectedWith('0x133'); // insufficient funds in farm

    // fund again with second amount
    await gf.callFundReward(secondAmount);

    await gf.verifyPotContains(pot, totalAmount);

    // update farm account
    farmAcc = await gf.fetchFarmAcc(gf.farm.publicKey);

    assert.equal(
      (farmAcc.rewardA as any).funds.totalFunded.toNumber(),
      totalAmount.toNumber()
    );

    const { vault } = await gf.callDeposit(
      gf.farmer1Identity,
      defaultFixedConfig.schedule.tier3
    );

    farmAcc = await gf.fetchFarmAcc(gf.farm.publicKey);

    let vaultAcc: any = await gf.fetchVaultAcc(vault);

    let totalAccruedToVault = defaultFixedConfig.schedule.tier3?.rewardRate.mul(
      defaultFixedConfig.schedule.tier3?.requiredTenure!
    );

    // confirm total number of vaults on farm updated
    assert.equal(farmAcc.vaultCount.toNumber(), 1);

    // the amount reserved should match the tier
    assert.equal(
      vaultAcc.rewardA.reservedAmount.toNumber(),
      totalAccruedToVault?.toNumber(),
      'The reserved amount on vault is incorrect.'
    );
    // reward tier must be saved on vault
    assert.equal(
      vaultAcc.rewardA.rewardTier.rewardRate.toNumber(),
      defaultFixedConfig.schedule.tier3?.rewardRate.toNumber(),
      'The reward rate on vault is incorrect.'
    );
    assert.equal(
      vaultAcc.rewardA.rewardTier.requiredTenure.toNumber(),
      defaultFixedConfig.schedule.tier3?.requiredTenure.toNumber(),
      'The required tenure on vault is incorrect.'
    );
  });

  it('FAILS when trying to deposit twice into the same vault', async () => {
    // deposit once
    await gf.callDeposit(gf.farmer1Identity);

    // attempt a second deposit
    await expect(gf.callDeposit(gf.farmer1Identity)).to.be.rejectedWith(
      '0x140'
    );
  });
});

export const customFixedConfig = <FixedRateConfig>{
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

describe('depositing gems into vault (denominator is not one)', () => {
  let gf = new GemFarmTester();

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(100000000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig, customFixedConfig.schedule);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
    const amount = new BN(Math.random() * 500000);
    await gf.callFundReward(amount);
  });

  it('deposits gem into a vault (denominator is not one)', async () => {
    // change from depositing into gem to depositing into gem box vault
    const { vault, farm } = await gf.callDeposit(
      gf.farmer1Identity,
      customFixedConfig.schedule.tier1
    );
    const { vault: vault2 } = await gf.callDeposit(
      gf.farmer2Identity,
      customFixedConfig.schedule.tier3
    );

    const vaultAcc: any = await gf.fetchVaultAcc(vault);
    const vault2Acc: any = await gf.fetchVaultAcc(vault2);
    const farmAcc: any = await gf.fetchFarmAcc(farm);

    const totalReserved =
      (customFixedConfig.schedule.tier1?.rewardRate?.toNumber()! /
        customFixedConfig.schedule.denominator.toNumber()) *
      customFixedConfig.schedule.tier1?.requiredTenure.toNumber()!;
    const totalReservedVault2 =
      (customFixedConfig.schedule.tier3?.rewardRate?.toNumber()! /
        customFixedConfig.schedule.denominator.toNumber()) *
      customFixedConfig.schedule.tier3?.requiredTenure.toNumber()!;

    assert.equal(vaultAcc.rewardA.reservedAmount.toNumber(), totalReserved);
    assert.equal(
      vault2Acc.rewardA.reservedAmount.toNumber(),
      totalReservedVault2
    );
    assert.equal(
      farmAcc.rewardA.funds.totalAccruedToStakers.toNumber(),
      totalReserved + totalReservedVault2
    );
  });
});

describe('depositing gems into vault (only 2 tiers defined)', () => {
  let gf = new GemFarmTester();

  const customFixedConfig = <FixedRateConfig>{
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
      tier3: null,
      denominator: toBN(10),
    },
  };

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(100000000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig, customFixedConfig.schedule);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
    const amount = new BN(Math.random() * 500000);
    await gf.callFundReward(amount);
  });

  it('deposits gem into a vault (only 2 tiers defined)', async () => {
    // change from depositing into gem to depositing into gem box vault
    const { vault, farm } = await gf.callDeposit(
      gf.farmer1Identity,
      customFixedConfig.schedule.tier1
    );
    const { vault: vault2 } = await gf.callDeposit(
      gf.farmer2Identity,
      customFixedConfig.schedule.tier3
    );

    const vaultAcc: any = await gf.fetchVaultAcc(vault);
    const vault2Acc: any = await gf.fetchVaultAcc(vault2);
    const farmAcc: any = await gf.fetchFarmAcc(farm);

    const totalReserved =
      (customFixedConfig.schedule.tier1?.rewardRate?.toNumber()! /
        customFixedConfig.schedule.denominator.toNumber()) *
      customFixedConfig.schedule.tier1?.requiredTenure.toNumber()!;

    assert.equal(vaultAcc.rewardA.reservedAmount.toNumber(), totalReserved);
  });
});
