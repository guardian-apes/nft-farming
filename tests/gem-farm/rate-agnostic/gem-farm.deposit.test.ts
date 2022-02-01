import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  defaultFarmConfig,
  defaultVariableConfig,
  GemFarmTester,
} from '../gem-farm.tester';
import { BN } from '@project-serum/anchor';
import { VariableRateConfig } from '../gem-farm.client';
import { pause } from '../../gem-common/util';

chai.use(chaiAsPromised);

const fastConfig = <VariableRateConfig>{
  amount: new BN(10000),
  durationSec: new BN(2),
};

describe('depositing gems into vault', () => {
  let gf = new GemFarmTester();

  beforeEach('preps accs', async () => {
    await gf.prepAccounts(10000, gf.randomInt(1, 3), gf.randomInt(1, 3));
    await gf.callInitFarm(defaultFarmConfig);
    await gf.callInitVault(gf.farmer1Identity);
    await gf.callInitVault(gf.farmer2Identity);
    await gf.callAuthorize();
  });

  it.only('deposits gem into a vault', async () => {
    const { vault, farm } = await gf.callDeposit(gf.gem1Amount, gf.farmer1Identity);
    const { vault: vault2 } = await gf.callDeposit(gf.gem2Amount, gf.farmer2Identity);

    const vaultAcc = await gf.fetchVaultAcc(vault);
    const vault2Acc = await gf.fetchVaultAcc(vault2);
    const farmAcc = await gf.fetchFarmAcc(farm);

    // make sure farm account counts correct number of vaults
    assert.equal(farmAcc.vaultCount.toNumber(), 2) // 2 vaults initialised on farm

    // make sure vault belongs to farm
    assert.equal(vaultAcc.farm.toBase58(), farm.toBase58())
    assert.equal(vault2Acc.farm.toBase58(), farm.toBase58())

    // make sure creators are gem owners
    assert.equal(vault2Acc.creator.toBase58(), gf.farmer2Identity.publicKey.toBase58())
    assert.equal(vaultAcc.creator.toBase58(), gf.farmer1Identity.publicKey.toBase58())

    // get all gem deposit receipts for this vault account
    const gemDepositReceipts = await gf.fetchAllGdrPDAs(vault)

    assert.equal(gemDepositReceipts.length, 1)
    assert.equal(gemDepositReceipts[0].account.vault?.toBase58(), vault?.toBase58())
    assert.equal(gemDepositReceipts[0].account.gemMint?.toBase58(), gf.gem1.tokenMint?.toBase58())

    assert.equal(gemDepositReceipts[0]?.account?.gemCount?.toNumber(), gf.gem1Amount?.toNumber())
  });

  it('FAILS when trying to deposit twice into the same vault', async () => {
    // deposit once
    await gf.callDeposit(gf.gem1Amount, gf.farmer1Identity);

    // attempt a second deposit
    await expect(
        gf.callDeposit(gf.gem1Amount, gf.farmer1Identity)
      ).to.be.rejectedWith('0x140');
  });
});
