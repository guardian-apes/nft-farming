import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Numerical, stringifyPKsAndBNs, toBN } from '../gem-common/types';
import * as anchor from '@project-serum/anchor';
import { BN } from '@project-serum/anchor';
import {
  FarmConfig,
  FixedRateConfig,
  FixedRateSchedule,
  GemFarmClient,
  RarityConfig,
  RewardType,
  TierConfig,
  VariableRateConfig,
} from './gem-farm.client';
import { Token, AccountInfo } from '@solana/spl-token';
import { ITokenData } from '../gem-common/account-utils';
import { assert } from 'chai';
import { WhitelistType } from '../gem-bank/gem-bank.client';
import { NodeWallet } from '../gem-common/node-wallet';

// --------------------------------------- configs

export const PRECISION = 10 ** 15;

export const defaultFarmConfig = <FarmConfig>{
  paperHandsTaxLamp: new BN(0),
};

export const defaultVariableConfig = <VariableRateConfig>{
  amount: new BN(10000), //10k
  durationSec: new BN(100), //at rate 100/s
};

export const defaultFixedConfig = <FixedRateConfig>{
  schedule: {
    //total 30 per gem
    tier0: {
      rewardRate: toBN(1),
      requiredTenure: toBN(0),
    },
    tier1: {
      rewardRate: toBN(5),
      requiredTenure: toBN(2),
    },
    tier2: {
      rewardRate: toBN(7),
      requiredTenure: toBN(4),
    },
    //leaving this one at 0 so that it's easy to test how much accrued over first 6s
    tier3: {
      rewardRate: toBN(9),
      requiredTenure: toBN(6),
    },
    denominator: toBN(1),
  },
};

// --------------------------------------- tester class

export class GemFarmTester extends GemFarmClient {
  //useful for quickly creating mint/token accounts
  nw: NodeWallet;

  //farm + bank
  bank!: Keypair;
  farm!: Keypair;
  farm2!: Keypair;
  farmManager!: Keypair;
  farmManager2!: Keypair;

  //farmer 1 + vault
  farmer1Identity!: Keypair;
  farmer1Vault!: PublicKey;
  farmer2Identity!: Keypair;
  farmer2Vault!: PublicKey;

  //rewards + funder
  reward = 'rewardA';
  rewardMint!: Token;
  rewardSource!: PublicKey;
  rewardSecondMint!: Token;
  funder: Keypair;

  //gem 1 used by farmer 1 / gem 2 by farmer 2
  gem1Amount!: anchor.BN;
  gem1!: ITokenData;
  gem1PerGemRarity!: number;
  gem2Amount!: anchor.BN;
  gem3Amount!: anchor.BN;
  gem4Amount!: anchor.BN;
  gem2!: ITokenData;
  gem3!: ITokenData;
  gem4!: ITokenData;
  gem2PerGemRarity!: number;

  constructor() {
    super(
      anchor.Provider.env().connection,
      anchor.Provider.env().wallet as anchor.Wallet
    );
    this.nw = new NodeWallet(
      anchor.Provider.env().connection,
      anchor.Provider.env().wallet as anchor.Wallet
    );
    this.funder = this.nw.wallet.payer;
  }

  async prepAccounts(
    initialFundingAmount: Numerical,
    gem1PerGemRarity: number = 1,
    gem2PerGemRarity: number = 1,
    reward?: string
  ) {
    reward = 'rewardA';
    console.log('running tests for', reward);

    this.bank = Keypair.generate();
    this.farm = Keypair.generate();
    this.farm2 = Keypair.generate();
    this.farmManager = await this.nw.createFundedWallet(100 * LAMPORTS_PER_SOL);
    this.farmManager2 = await this.nw.createFundedWallet(100 * LAMPORTS_PER_SOL);

    this.farmer1Identity = await this.nw.createFundedWallet(
      100 * LAMPORTS_PER_SOL
    );

    this.farmer2Identity = await this.nw.createFundedWallet(
      100 * LAMPORTS_PER_SOL
    );

    if (reward) this.reward = reward;
    this.rewardMint = await this.nw.createMint(0);
    this.rewardSource = await this.nw.createAndFundATA(
      this.rewardMint,
      this.funder.publicKey,
      toBN(initialFundingAmount)
    );
    this.rewardSecondMint = await this.nw.createMint(0);

    //gem 1
    ({ gemAmount: this.gem1Amount, gem: this.gem1 } = await this.prepGem(
      this.farmer1Identity
    ));
    this.gem1PerGemRarity = gem1PerGemRarity;

    //gem 2
    ({ gemAmount: this.gem2Amount, gem: this.gem2 } = await this.prepGem(
      this.farmer2Identity
    ));

    //gem 3
    ({ gemAmount: this.gem3Amount, gem: this.gem3 } = await this.prepGem(
      this.farmer1Identity
    ));

    //gem 4
    ({ gemAmount: this.gem4Amount, gem: this.gem4 } = await this.prepGem(
      this.farmer2Identity
    ));
    this.gem2PerGemRarity = gem2PerGemRarity;
  }

  randomInt(min: number, max: number) {
    // min and max included
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  async prepGem(owner?: Keypair) {
    const gemAmount = new BN(100 + Math.ceil(Math.random() * 100)); //min 100
    const gemOwner =
      owner ?? (await this.nw.createFundedWallet(100 * LAMPORTS_PER_SOL));
    const gem = await this.nw.createMintAndFundATA(
      gemOwner.publicKey,
      gemAmount
    );

    return { gemAmount, gemOwner, gem };
  }

  // --------------------------------------- getters

  async fetchFarm() {
    return this.fetchFarmAcc(this.farm.publicKey);
  }

  async fetchFarm2() {
    return this.fetchFarmAcc(this.farm2.publicKey);
  }

  async fetchTreasuryBal() {
    return this.fetchTreasuryBalance(this.farm.publicKey);
  }

  // --------------------------------------- callers
  // ----------------- core

  async callInitSecondFarm(farmConfig: FarmConfig) {
    return this.initFarm(
      this.farm2,
      this.farmManager2,
      this.farmManager2,
      this.rewardMint.publicKey,
      RewardType.Fixed,
      defaultFixedConfig.schedule,
      farmConfig
    );
  }

  async callInitFarm(farmConfig: FarmConfig, schedule?: FixedRateSchedule) {
    return this.initFarm(
      this.farm,
      this.farmManager,
      this.farmManager,
      this.rewardMint.publicKey,
      RewardType.Fixed,
      schedule || defaultFixedConfig.schedule,
      farmConfig
    );
  }

  async callUpdateFarm(farmConfig?: FarmConfig, newManager?: PublicKey) {
    return this.updateFarm(
      this.farm.publicKey,
      this.farmManager,
      farmConfig,
      newManager
    );
  }

  async callPayout(destination: PublicKey, lamports: Numerical) {
    return this.payoutFromTreasury(
      this.farm.publicKey,
      this.farmManager,
      destination,
      toBN(lamports)
    );
  }

  // ----------------- farmer

  async callInitVault(identity: Keypair, token: PublicKey, farm?: PublicKey) {
    return this.initVault(farm || this.farm.publicKey, identity, token);
  }

  async callWithdraw(identity: Keypair, mint: PublicKey, farm?: PublicKey) {
    return this.withdrawGemFromVault(farm || this.farm.publicKey, identity, mint, this.rewardMint.publicKey)
  }

  async callWhitelistCreator(creator: PublicKey, farm?: PublicKey, manager?: Keypair) {
    return this.whitelistCreator(farm || this.farm.publicKey, manager || this.farmManager, creator)
  }

  async callDeposit(identity: Keypair, tierSchedule: TierConfig|null = null, farm?: PublicKey) {
    const isFarmer1 =
      identity.publicKey.toBase58() ===
      this.farmer1Identity.publicKey.toBase58();

    return this.depositGem(
      farm || this.farm.publicKey,
      isFarmer1 ? this.farmer1Identity : this.farmer2Identity,
      isFarmer1 ? this.gem1.tokenMint : this.gem2.tokenMint,
      isFarmer1 ? this.gem1.tokenAcc : this.gem2.tokenAcc,
      tierSchedule
    );
  }

  async callClaimRewards(identity: Keypair, gemMint: PublicKey) {
    return this.claim(
      this.farm.publicKey,
      identity,
      this.rewardMint.publicKey,
      gemMint
    );
  }

  // ----------------- funder

  async callAuthorize(farm?: PublicKey, manager?: Keypair) {
    return this.authorizeFunder(
      farm || this.farm.publicKey,
      manager || this.farmManager,
      this.funder.publicKey
    );
  }

  async callDeauthorize() {
    return this.deauthorizeFunder(
      this.farm.publicKey,
      this.farmManager,
      this.funder.publicKey
    );
  }

  // ----------------- rewards

  async callFundReward(amount: BN, farm?: PublicKey) {
    return this.fundReward(
      farm || this.farm.publicKey,
      this.rewardMint.publicKey,
      this.funder,
      this.rewardSource,
      amount
    );
  }

  // --------------------------------------- verifiers

  // ----------------- funding

  async verifyFunds(
    funded?: Numerical,
    refunded?: Numerical,
    accrued?: Numerical
  ) {
    let farmAcc = (await this.fetchFarm()) as any;
    let funds = farmAcc[this.reward].funds;

    if (funded || funded === 0) {
      assert(funds.totalFunded.eq(toBN(funded)));
    }
    if (refunded || refunded === 0) {
      assert(funds.totalRefunded.eq(toBN(refunded)));
    }
    if (accrued || accrued === 0) {
      assert(funds.totalAccruedToStakers.eq(toBN(accrued)));
    }

    return funds;
  }

  async verifyTimes(
    duration?: Numerical,
    rewardEnd?: Numerical,
    lockEnd?: Numerical
  ) {
    let farmAcc = (await this.fetchFarm()) as any;
    let times = farmAcc[this.reward].times;

    if (duration || duration === 0) {
      assert(times.durationSec.eq(toBN(duration)));
    }
    if (rewardEnd || rewardEnd === 0) {
      assert(times.rewardEndTs.eq(toBN(rewardEnd)));
    }
    if (lockEnd || lockEnd === 0) {
      assert(times.lockEndTs.eq(toBN(lockEnd)));
    }

    return times;
  }

  async verifyVariableReward(
    rewardRate?: Numerical,
    lastUpdated?: Numerical,
    accruedRewardPerRarityPoint?: Numerical
  ) {
    let farmAcc = (await this.fetchFarm()) as any;
    let reward = farmAcc[this.reward].variableRate;

    if (rewardRate || rewardRate === 0) {
      assert(reward.rewardRate.n.div(toBN(PRECISION)).eq(toBN(rewardRate)));
    }
    if (lastUpdated || lastUpdated === 0) {
      assert(reward.rewardLastUpdatedTs.eq(toBN(lastUpdated)));
    }
    if (accruedRewardPerRarityPoint || accruedRewardPerRarityPoint === 0) {
      assert(
        reward.accruedRewardPerRarityPoint.n
          .div(toBN(PRECISION))
          .eq(toBN(accruedRewardPerRarityPoint))
      );
    }

    return reward;
  }

  async verifyFixedReward(reservedAmount?: Numerical) {
    let farmAcc = (await this.fetchFarm()) as any;
    let reward = farmAcc[this.reward].fixedRate;

    // console.log('reserved is', reward.reservedAmount.toNumber());
    // console.log('expected is', toBN(reservedAmount).toNumber());

    if (reservedAmount || reservedAmount === 0) {
      assert(reward.reservedAmount.eq(toBN(reservedAmount)));
    }

    return reward;
  }

  async verifyPotContains(pot: PublicKey, amount: Numerical, sign?: string) {
    const rewardsPotAcc = await this.fetchTokenAcc(
      this.rewardMint.publicKey,
      pot
    );

    console.log('@rewardsPotAcc', rewardsPotAcc.amount.toNumber())

    switch (sign) {
      case 'lt':
        assert(rewardsPotAcc.amount.lt(toBN(amount)));
        break;
      default:
        assert(rewardsPotAcc.amount.eq(toBN(amount)));
    }

    return rewardsPotAcc;
  }

  async verifyFunderAccContains(amount: Numerical, sign?: string) {
    const sourceAcc = await this.fetchTokenAcc(
      this.rewardMint.publicKey,
      this.rewardSource
    );
    switch (sign) {
      case 'gt':
        assert(sourceAcc.amount.gt(toBN(amount)));
        break;
      default:
        assert(sourceAcc.amount.eq(toBN(amount)));
    }

    return sourceAcc;
  }

  // ----------------- staking

  calcTotalGems(gem1Amount?: Numerical, gem2Amount?: Numerical) {
    return toBN(gem1Amount ?? this.gem1Amount).add(
      toBN(gem2Amount ?? this.gem2Amount)
    );
  }

  calcTotalGemRarity(gem1Amount?: Numerical, gem2Amount?: Numerical) {
    const gem1 = toBN(gem1Amount ?? this.gem1Amount).mul(
      toBN(this.gem1PerGemRarity)
    );
    const gem2 = toBN(gem2Amount ?? this.gem2Amount).mul(
      toBN(this.gem2PerGemRarity)
    );
    const total = gem1.add(gem2);

    // console.log(
    //   'rarities are: (gem1, gem2, total): ',
    //   gem1.toNumber(),
    //   gem2.toNumber(),
    //   total.toNumber()
    // );

    return { gem1, gem2, total };
  }

  async mintMoreRewards(amount: number) {
    await this.rewardMint.mintTo(this.rewardSource, this.funder, [], amount);
  }

  async fetchGemAcc(mint: PublicKey, gemAcc: PublicKey): Promise<AccountInfo> {
    return this.deserializeTokenAccount(mint, gemAcc);
  }
}
