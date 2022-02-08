import * as anchor from '@project-serum/anchor';
import { BN, Idl, Program, Provider, Wallet } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  AccountInfo,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { AccountUtils } from '../gem-common/account-utils';
import { isKp } from '../gem-common/types';

export enum BankFlags {
  FreezeVaults = 1 << 0,
}

export enum WhitelistType {
  Creator = 1 << 0,
  Mint = 1 << 1,
}

export class GemBankClient extends AccountUtils {
  wallet: anchor.Wallet;
  provider!: anchor.Provider;

  constructor(
    conn: Connection,
    wallet: Wallet,
    idl?: Idl,
    programId?: PublicKey
  ) {
    super(conn);
    this.wallet = wallet;
    this.setProvider();
  }

  setProvider() {
    this.provider = new Provider(
      this.conn,
      this.wallet,
      Provider.defaultOptions()
    );
    anchor.setProvider(this.provider);
  }

  // --------------------------------------- fetch deserialized accounts

  // --------------------------------------- find PDA addresses

  // --------------------------------------- get all PDAs by type
  //https://project-serum.github.io/anchor/ts/classes/accountclient.html#all

}
