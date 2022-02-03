import * as anchor from '@project-serum/anchor';
import { BN, Idl, Program, Wallet } from '@project-serum/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { GemFarm } from '../../target/types/gem_farm';
import { Connection } from '@metaplex/js';
import { isKp, stringifyPKsAndBNs } from '../gem-common/types';
import { GemBankClient, WhitelistType } from '../gem-bank/gem-bank.client';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

//acts as an enum
export const RewardType = {
  Variable: { variable: {} },
  Fixed: { fixed: {} },
};

export interface FarmConfig {
  paperHandsTaxLamp: BN;
}

export interface TierConfig {
  rewardRate: BN;
  requiredTenure: BN;
}

export interface FixedRateSchedule {
  tier0: TierConfig
  tier1: TierConfig | null;
  tier2: TierConfig | null;
  tier3: TierConfig | null;
  denominator: BN;
}

export interface FixedRateConfig {
  schedule: FixedRateSchedule;
  reserved_amount: BN;
}

export interface VariableRateConfig {
  amount: BN;
  durationSec: BN;
}

export interface RarityConfig {
  mint: PublicKey;
  rarityPoints: number;
}

export class GemFarmClient extends GemBankClient {
  farmProgram!: anchor.Program<GemFarm>;

  constructor(
    conn: Connection,
    wallet: Wallet,
    farmIdl?: Idl,
    farmProgramId?: PublicKey,
    bankIdl?: Idl,
    bankProgramId?: PublicKey
  ) {
    super(conn, wallet, bankIdl, bankProgramId);
    this.setFarmProgram(farmIdl, farmProgramId);
  }

  setFarmProgram(idl?: Idl, programId?: PublicKey) {
    //instantiating program depends on the environment
    if (idl && programId) {
      //means running in prod
      this.farmProgram = new anchor.Program<GemFarm>(
        idl as any,
        programId,
        this.provider
      );
    } else {
      //means running inside test suite
      this.farmProgram = anchor.workspace.GemFarm as Program<GemFarm>;
    }
  }

  // --------------------------------------- fetch deserialized accounts

  async fetchFarmAcc(farm: PublicKey) {
    return this.farmProgram.account.farm.fetch(farm);
  }

  async fetchAuthorizationProofAcc(authorizationProof: PublicKey) {
    return this.farmProgram.account.authorizationProof.fetch(
      authorizationProof
    );
  }

  async fetchTokenAcc(rewardMint: PublicKey, rewardAcc: PublicKey) {
    return this.deserializeTokenAccount(rewardMint, rewardAcc);
  }

  async fetchTreasuryBalance(farm: PublicKey) {
    const [treasury] = await this.findFarmTreasuryPDA(farm);
    return this.getBalance(treasury);
  }

  // --------------------------------------- find PDA addresses

  async findFarmerPDA(farm: PublicKey, identity: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'farmer',
      farm,
      identity,
    ]);
  }

  async findFarmAuthorityPDA(farm: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [farm]);
  }

  async findFarmTreasuryPDA(farm: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'treasury',
      farm,
    ]);
  }

  async findAuthorizationProofPDA(farm: PublicKey, funder: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'authorization',
      farm,
      funder,
    ]);
  }

  async findRewardsPotPDA(farm: PublicKey, rewardMint: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'reward_pot',
      farm,
      rewardMint,
    ]);
  }

  // --------------------------------------- get all PDAs by type
  //https://project-serum.github.io/anchor/ts/classes/accountclient.html#all

  async fetchAllFarmPDAs(manager?: PublicKey) {
    const filter = manager
      ? [
          {
            memcmp: {
              offset: 10, //need to prepend 8 bytes for anchor's disc
              bytes: manager.toBase58(),
            },
          },
        ]
      : [];
    const pdas = await this.farmProgram.account.farm.all(filter);
    console.log(`found a total of ${pdas.length} farm PDAs`);
    return pdas;
  }

  async fetchAllFarmerPDAs(farm?: PublicKey, identity?: PublicKey) {
    const filter: any = [];
    if (farm) {
      filter.push({
        memcmp: {
          offset: 8, //need to prepend 8 bytes for anchor's disc
          bytes: farm.toBase58(),
        },
      });
    }
    if (identity) {
      filter.push({
        memcmp: {
          offset: 40, //need to prepend 8 bytes for anchor's disc
          bytes: identity.toBase58(),
        },
      });
    }
    const pdas = await this.farmProgram.account.vault.all(filter);
    console.log(`found a total of ${pdas.length} vault PDAs`);
    return pdas;
  }

  async fetchAllAuthProofPDAs(farm?: PublicKey, funder?: PublicKey) {
    const filter: any = [];
    if (farm) {
      filter.push({
        memcmp: {
          offset: 40, //need to prepend 8 bytes for anchor's disc
          bytes: farm.toBase58(),
        },
      });
    }
    if (funder) {
      filter.push({
        memcmp: {
          offset: 8, //need to prepend 8 bytes for anchor's disc
          bytes: funder.toBase58(),
        },
      });
    }
    const pdas = await this.farmProgram.account.authorizationProof.all(filter);
    console.log(`found a total of ${pdas.length} authorized funders`);
    return pdas;
  }

  // --------------------------------------- core ixs

  async initFarm(
    farm: Keypair,
    farmManager: PublicKey | Keypair,
    payer: PublicKey | Keypair,
    rewardAMint: PublicKey,
    rewardAType: any, //RewardType instance
    fixedRateScheduleA: FixedRateSchedule,
    farmConfig: FarmConfig
  ) {
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(
      farm.publicKey
    );
    const [farmTreasury, farmTreasuryBump] = await this.findFarmTreasuryPDA(
      farm.publicKey
    );
    const [rewardAPot, rewardAPotBump] = await this.findRewardsPotPDA(
      farm.publicKey,
      rewardAMint
    );

    const signers = [farm];
    if (isKp(farmManager)) signers.push(<Keypair>farmManager);

    console.log('starting farm at', farm.publicKey.toBase58());
    const txSig = await this.farmProgram.rpc.initFarm(
      farmAuthBump,
      farmTreasuryBump,
      rewardAPotBump,
      rewardAType,
      fixedRateScheduleA,
      farmConfig,
      {
        accounts: {
          farm: farm.publicKey,
          farmManager: isKp(farmManager)
            ? (<Keypair>farmManager).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          farmTreasury,
          payer: isKp(payer) ? (<Keypair>payer).publicKey : farmManager,
          rewardAPot,
          rewardAMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      farmTreasury,
      farmTreasuryBump,
      rewardAPot,
      rewardAPotBump,
      txSig,
    };
  }

  async updateFarm(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    config: FarmConfig | null = null,
    newManager: PublicKey | null = null
  ) {
    const signers = [];
    if (isKp(farmManager)) signers.push(<Keypair>farmManager);

    console.log('updating farm');
    const txSig = await this.farmProgram.rpc.updateFarm(config, newManager, {
      accounts: {
        farm,
        farmManager: isKp(farmManager)
          ? (<Keypair>farmManager).publicKey
          : farmManager,
      },
      signers,
    });

    return { txSig };
  }

  async payoutFromTreasury(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    destination: PublicKey,
    lamports: BN
  ) {
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [farmTreasury, farmTreasuryBump] = await this.findFarmTreasuryPDA(
      farm
    );

    const signers = [];
    if (isKp(farmManager)) signers.push(<Keypair>farmManager);

    console.log('paying out from treasury', farmTreasury.toBase58());
    const txSig = await this.farmProgram.rpc.payoutFromTreasury(
      farmAuthBump,
      farmTreasuryBump,
      lamports,
      {
        accounts: {
          farm,
          farmManager: isKp(farmManager)
            ? (<Keypair>farmManager).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          farmTreasury,
          destination,
          systemProgram: SystemProgram.programId,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      farmTreasury,
      farmTreasuryBump,
      txSig,
    };
  }

  // --------------------------------------- farmer ops ixs

  async initVault(
    farm: PublicKey,
    identity: PublicKey | Keypair,
    gemMint: PublicKey
  ) {
    const creatorPk = isKp(identity)
      ? (<Keypair>identity).publicKey
      : <PublicKey>identity;

    const [vault, vaultBump] = await this.findVaultPDA(farm, creatorPk, gemMint);

    const signers = [];
    if (isKp(identity)) signers.push(<Keypair>identity);

    console.log('creating vault at', vault.toBase58(), ' for farm ', farm.toBase58());
    const txSig = await this.farmProgram.rpc.initVault(vaultBump, {
      accounts: {
        farm,
        vault,
        gemMint,
        owner: creatorPk,
        payer: creatorPk,
        systemProgram: SystemProgram.programId,
      },
      signers,
    });

    return { vault, vaultBump, txSig };
  }

  async claim(
    farm: PublicKey,
    farmerIdentity: PublicKey | Keypair,
    rewardAMint: PublicKey,
    gemMint: PublicKey
  ) {
    const identityPk = isKp(farmerIdentity)
      ? (<Keypair>farmerIdentity).publicKey
      : <PublicKey>farmerIdentity;

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [vault, vaultBump] = await this.findVaultPDA(farm, identityPk, gemMint);

    const [potA, potABump] = await this.findRewardsPotPDA(farm, rewardAMint);

    const rewardADestination = await this.findATA(rewardAMint, identityPk);

    const signers = [];
    if (isKp(farmerIdentity)) signers.push(<Keypair>farmerIdentity);

    const txSig = await this.farmProgram.rpc.claimRewards(
      farmAuthBump,
      vaultBump,
      potABump,
      {
        accounts: {
          farm,
          farmAuthority: farmAuth,
          vault,
          gemMint,
          owner: identityPk,
          rewardAPot: potA,
          rewardAMint,
          rewardADestination,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      potA,
      potABump,
      rewardADestination,
      txSig,
    };
  }

  async withdrawGemFromVault(
    farm: PublicKey,
    vaultOwner: Keypair,
    gemMint: PublicKey,
    rewardAMint: PublicKey
  ) {
    const [vault] = await this.findVaultPDA(farm, vaultOwner.publicKey, gemMint)
    const [gemBox, gemBoxBump] = await this.findGemBoxPDA(vault);
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault);
    const gemDestination = await this.findATA(gemMint, vaultOwner.publicKey)
    const [farmTreasury, farmTreasuryBump] = await this.findFarmTreasuryPDA(
      farm
    );
    const [rewardAPot, rewardAPotBump] = await this.findRewardsPotPDA(
      farm,
      rewardAMint
    );
    const rewardADestination = await this.findATA(rewardAMint, vaultOwner.publicKey);
  
    console.log(`withdrawing 1 gem from vault ${vault} on farm ${farm}`)

    const txSig = await this.farmProgram.rpc.withdrawGem(farmAuthBump, farmTreasuryBump, vaultAuthBump, gemBoxBump, rewardAPotBump, {
      accounts: {
        farm,
        gemMint,
        gemBox,
        vault,
        farmTreasury,
        rewardADestination,
        rewardAMint,
        farmAuthority: farmAuth,
        rewardAPot,
        owner: vaultOwner.publicKey,
        authority: vaultAuth,
        gemDestination,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [vaultOwner]
    });

    return {
      txSig,
      gemBoxBump,
      gemBox,
      gemDestination
    }
  }

  async depositGem(
    farm: PublicKey,
    vaultOwner: PublicKey | Keypair,
    gemMint: PublicKey,
    gemSource: PublicKey,
    tierConfig: TierConfig|null,
    mintProof?: PublicKey,
    metadata?: PublicKey,
    creatorProof?: PublicKey
  ) {
    const owner = (isKp(vaultOwner)
    ? (<Keypair>vaultOwner).publicKey
    : vaultOwner) as unknown as PublicKey
    const [vault] = await this.findVaultPDA(farm, owner, gemMint);
    const [gemBox, gemBoxBump] = await this.findGemBoxPDA(vault);
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault);

    const remainingAccounts = [];
    if (mintProof)
      remainingAccounts.push({
        pubkey: mintProof,
        isWritable: false,
        isSigner: false,
      });
    if (metadata)
      remainingAccounts.push({
        pubkey: metadata,
        isWritable: false,
        isSigner: false,
      });
    if (creatorProof)
      remainingAccounts.push({
        pubkey: creatorProof,
        isWritable: false,
        isSigner: false,
      });

    const signers = [];
    if (isKp(vaultOwner)) signers.push(<Keypair>vaultOwner);

    console.log(
      `depositing 1 gems into  vault: ${vault.toBase58()} on farm: ${farm.toBase58()}`
    );
    const txSig = await this.farmProgram.rpc.depositGem(
      vaultAuthBump,
      gemBoxBump,
      tierConfig,
      {
        accounts: {
          vault,
          farm,
          owner,
          gemSource,
          gemBox,
          gemMint,
          authority: vaultAuth,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        remainingAccounts,
        signers,
      }
    );

    return {
      vaultAuth,
      vaultAuthBump,
      gemBox,
      vault,
      farm,
      gemBoxBump,
      txSig,
    };
  }

  async fetchVaultAcc(vault: PublicKey) {
    return this.farmProgram.account.vault.fetch(vault);
  }

  async fetchAllGdrPDAs(vault?: PublicKey) {
    const filter = vault
      ? [
          {
            memcmp: {
              offset: 8, //need to prepend 8 bytes for anchor's disc
              bytes: vault.toBase58(),
            },
          },
        ]
      : [];
    const pdas = await this.farmProgram.account.gemDepositReceipt.all(filter);
    console.log(`found a total of ${pdas.length} GDR PDAs for vault: ${vault?.toBase58()}`);
    return pdas;
  }

  async findVaultAuthorityPDA(vault: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [vault]);
  }

  async findGemBoxPDA(vault: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'gem_box',
      vault,
    ]);
  }

  async findGdrPDA(vault: PublicKey, mint: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'gem_deposit_receipt',
      vault,
      mint,
    ]);
  }

  // --------------------------------------- funder ops ixs

  async authorizeCommon(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    funder: PublicKey,
    deauthorize = false
  ) {
    const [authorizationProof, authorizationProofBump] =
      await this.findAuthorizationProofPDA(farm, funder);

    const signers = [];
    if (isKp(farmManager)) signers.push(<Keypair>farmManager);

    let txSig;
    if (deauthorize) {
      console.log('DEauthorizing funder', funder.toBase58());
      txSig = await this.farmProgram.rpc.deauthorizeFunder(
        authorizationProofBump,
        {
          accounts: {
            farm,
            farmManager: isKp(farmManager)
              ? (<Keypair>farmManager).publicKey
              : farmManager,
            funderToDeauthorize: funder,
            authorizationProof,
            systemProgram: SystemProgram.programId,
          },
          signers,
        }
      );
    } else {
      console.log('authorizing funder', funder.toBase58());
      txSig = await this.farmProgram.rpc.authorizeFunder(
        authorizationProofBump,
        {
          accounts: {
            farm,
            farmManager: isKp(farmManager)
              ? (<Keypair>farmManager).publicKey
              : farmManager,
            funderToAuthorize: funder,
            authorizationProof,
            systemProgram: SystemProgram.programId,
          },
          signers,
        }
      );
    }

    return { authorizationProof, authorizationProofBump, txSig };
  }

  async authorizeFunder(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    funderToAuthorize: PublicKey
  ) {
    return this.authorizeCommon(farm, farmManager, funderToAuthorize, false);
  }

  async deauthorizeFunder(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    funderToDeauthorize: PublicKey
  ) {
    return this.authorizeCommon(farm, farmManager, funderToDeauthorize, true);
  }

  // --------------------------------------- reward ops ixs

  async fundReward(
    farm: PublicKey,
    rewardMint: PublicKey,
    funder: PublicKey | Keypair,
    rewardSource: PublicKey,
    amount: BN
  ) {
    const funderPk = isKp(funder)
      ? (<Keypair>funder).publicKey
      : <PublicKey>funder;

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [authorizationProof, authorizationProofBump] =
      await this.findAuthorizationProofPDA(farm, funderPk);
    const [pot, potBump] = await this.findRewardsPotPDA(farm, rewardMint);

    const signers = [];
    if (isKp(funder)) signers.push(<Keypair>funder);

    console.log('funding reward pot', pot.toBase58(), ' with ', amount.toNumber(), ' tokens');
    const txSig = await this.farmProgram.rpc.fundReward(
      authorizationProofBump,
      potBump,
      amount,
      {
        accounts: {
          farm,
          authorizationProof,
          authorizedFunder: funderPk,
          rewardPot: pot,
          rewardSource,
          rewardMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      authorizationProof,
      authorizationProofBump,
      pot,
      potBump,
      txSig,
      rewardMint
    };
  }


  // --------------------------------------- helpers

  //returns "variable" or "fixed"
  parseRewardType(reward: any): string {
    return Object.keys(reward.rewardType)[0];
  }

  //returns "staked" / "unstaked" / "pendingCooldown"
  parseFarmerState(farmer: any): string {
    return Object.keys(farmer.state)[0];
  }

  async findVaultPDA(farm: PublicKey, creator: PublicKey, mint: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'vault',
      farm,
      creator,
      mint
    ]);
  }
}
