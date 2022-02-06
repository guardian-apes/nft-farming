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
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

chai.use(chaiAsPromised);

const fastConfig = <VariableRateConfig>{
  amount: new BN(10000),
  durationSec: new BN(2),
};

describe('withdraws gems from vault', () => {
  let gf = new GemFarmTester();

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000000, gf.randomInt(1, 3), 0.1); // 0.1 for rewardA
    await gf.callInitFarm(defaultFarmConfig);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint);
    await gf.callAuthorize();
    const amount = new BN(Math.random() * 50000)
    await gf.callFundReward(amount)
  });

  it('deposit gem -> wait 5 seconds -> withdraw gem (tier0)', async () => {
    // change from depositing into gem to depositing into gem box vault
    const { vault,farm } = await gf.callDeposit(gf.farmer1Identity);
    await gf.callDeposit(gf.farmer2Identity);

    const gemDestination = await gf.findATA(gf.gem1.tokenMint, gf.farmer1Identity.publicKey)

    const farmAccount = await gf.fetchFarmAcc(farm)
    const prevAccount = await gf.fetchTokenAcc(gf.gem1.tokenMint, gemDestination)

    const [gemBoxPDA] = await gf.findGemBoxPDA(vault)

    const gemBoxPDAAccount = await gf.fetchGemAcc(gf.gem1.tokenMint, gemBoxPDA)

    // make sure gem box has one token (the deposited nft)
    assert.equal(gemBoxPDAAccount.amount.toNumber(), 1)

    await pause(5000)

    const vaultAcc = await gf.fetchVaultAcc(vault);

    // also make sure 

    await gf.callWithdraw(gf.farmer1Identity, vaultAcc.gemMint)

    const updatedFarmAccount = await gf.fetchFarmAcc(farm)

    const destinationAccount = await gf.fetchTokenAcc(gf.gem1.tokenMint, gemDestination)

    // make sure vault count is updated (reduced by 1 after withdrawal)
    assert.equal(farmAccount.vaultCount.toNumber() - 1, updatedFarmAccount.vaultCount.toNumber())
    assert.equal(prevAccount.amount.toNumber() + 1, destinationAccount.amount.toNumber()) // one nft was transfered to this destination

    // make sure gem box is closed after withdrawal
    await expect(
      gf.fetchGemAcc(gf.gem1.tokenMint, gemBoxPDA)
    ).to.be.rejectedWith('Failed to find account');

    // make sure vault is closed after withdrawal
    await expect( gf.fetchVaultAcc(vault)).to.be.rejectedWith(`Account does not exist ${vault.toBase58()}`);
  });
  it('deposit gem (with paper hands tax) -> wait 5 seconds -> withdraw gem (tier3) -> break bank -> farm reserved updated', async () => {
    // Prep second farm
    const farmConfig = {
      paperHandsTaxLamp: new BN(LAMPORTS_PER_SOL).mul(new BN(5)) // paper hands tax is 5 sol
    }

    await gf.callInitSecondFarm(farmConfig);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint, gf.farm2.publicKey);
    await gf.callInitVault(gf.farmer2Identity, gf.gem2.tokenMint, gf.farm2.publicKey);
    await gf.callAuthorize(gf.farm2.publicKey, gf.farmManager2);
    const amount = new BN(Math.random() * 500000)
    await gf.callFundReward(amount, gf.farm2.publicKey)

    const { vault } = await gf.callDeposit(gf.farmer1Identity, defaultFixedConfig.schedule.tier3, gf.farm2.publicKey); // requires at least 6 seconds of staking
    await gf.callDeposit(gf.farmer2Identity, defaultFixedConfig.schedule.tier2, gf.farm2.publicKey); // requires at least 6 seconds of staking


    const farmAcc: any = await gf.fetchFarmAcc(gf.farm2.publicKey)
    const vaultAcc = await gf.fetchVaultAcc(vault)

    await gf.callWithdraw(gf.farmer1Identity, vaultAcc.gemMint, gf.farm2.publicKey)

    const updatedFarmAcc: any = await gf.fetchFarmAcc(gf.farm2.publicKey)

    assert.equal(farmAcc.vaultCount.toNumber() - 1, updatedFarmAcc.vaultCount.toNumber())
    assert.isTrue(updatedFarmAcc.rewardA.funds.totalAccruedToStakers.toNumber() < farmAcc.rewardA.funds.totalAccruedToStakers.toNumber())
  })

  it('deposit gem -> wait 5 seconds -> withdraw gem (tier3) -> attempt to break bank (no paper hands configured)', async () => {
    const { vault } = await gf.callDeposit(gf.farmer1Identity, defaultFixedConfig.schedule.tier3); // requires at least 6 seconds of staking

    const [gemBoxPDA] = await gf.findGemBoxPDA(vault)

    const gemBoxPDAAccount = await gf.fetchGemAcc(gf.gem1.tokenMint, gemBoxPDA)

    // make sure gem box has one token (the deposited nft)
    assert.equal(gemBoxPDAAccount.amount.toNumber(), 1)

    await pause(4000) // stake for 4 seconds. now change mind on staking. withdraw.

    const vaultAcc: any = await gf.fetchVaultAcc(vault);

    await expect(gf.callWithdraw(gf.farmer1Identity, vaultAcc.gemMint)).to.be.rejectedWith('0x134')
  })

  it('deposit gem  (into farm with paper hands tax)-> wait 5 seconds -> withdraw gem (tier3) -> successfully break bank', async () => {
    // Prep second farm
    const farmConfig = {
      paperHandsTaxLamp: new BN(LAMPORTS_PER_SOL).mul(new BN(5)) // paper hands tax is 5 sol
    }

    await gf.callInitSecondFarm(farmConfig);
    await gf.callInitVault(gf.farmer1Identity, gf.gem1.tokenMint, gf.farm2.publicKey);
    await gf.callAuthorize(gf.farm2.publicKey, gf.farmManager2);
    const amount = new BN(Math.random() * 500000)
    await gf.callFundReward(amount, gf.farm2.publicKey)

    const { vault, farm } = await gf.callDeposit(gf.farmer1Identity, defaultFixedConfig.schedule.tier3, gf.farm2.publicKey); // requires at least 6 seconds of staking

    const gemDestination = await gf.findATA(gf.gem1.tokenMint, gf.farmer1Identity.publicKey)

    const prevAccount = await gf.fetchTokenAcc(gf.gem1.tokenMint, gemDestination)
    
    const [gemBoxPDA] = await gf.findGemBoxPDA(vault)

    const gemBoxPDAAccount = await gf.fetchGemAcc(gf.gem1.tokenMint, gemBoxPDA)

    // make sure gem box has one token (the deposited nft)
    assert.equal(gemBoxPDAAccount.amount.toNumber(), 1)

    await pause(4000) // stake for 4 seconds. now change mind on staking. withdraw.

    const vaultAcc: any = await gf.fetchVaultAcc(vault);

    const farmAcc = await gf.fetchFarmAcc(farm)

    await gf.callWithdraw(gf.farmer1Identity, vaultAcc.gemMint, gf.farm2.publicKey)

    const updatedFarmAcc = await gf.fetchFarmAcc(farm)

    const destinationAccount = await gf.fetchTokenAcc(gf.gem1.tokenMint, gemDestination)

    assert.equal(farmAcc.vaultCount.toNumber() - 1, updatedFarmAcc.vaultCount.toNumber())
    assert.equal(prevAccount.amount.toNumber() + 1, destinationAccount.amount.toNumber()) // one nft was transfered to this destination

    // make sure gem box is closed after withdrawal
    await expect(
      gf.fetchGemAcc(gf.gem1.tokenMint, gemBoxPDA)
    ).to.be.rejectedWith('Failed to find account');

    // make sure the paper hands tax was deducted from owner account
    const balance = await gf.fetchTreasuryBalance(gf.farm2.publicKey);

    // the treasury should have tax deducted due to bank break
    assert.equal(balance, farmConfig.paperHandsTaxLamp.toNumber())
  })
});
