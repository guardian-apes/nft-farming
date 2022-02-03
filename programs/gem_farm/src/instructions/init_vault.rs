use std::io::Write;

use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_lang::prelude::*;
use gem_common::*;

use crate::state::*;

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitVault<'info> {
    // farm
    #[account(mut)]
    pub farm: Box<Account<'info, Farm>>,

    // vault
    #[account(init, seeds = [
            b"vault".as_ref(),
            farm.key().as_ref(),
            owner.key().as_ref(),
            gem_mint.key().as_ref(),
        ],
        bump = bump,
        payer = payer,
        space = 8 + std::mem::size_of::<Vault>())]
    pub vault: Box<Account<'info, Vault>>,

    // The designated owner of this vault
    pub owner: Signer<'info>,

    pub gem_mint: Box<Account<'info, Mint>>,

    // misc
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitVault>) -> ProgramResult {
    // record total number of vaults in farm's state
    let farm = &mut ctx.accounts.farm;
    let vault = &mut ctx.accounts.vault;

    // derive the authority responsible for all token transfers within the new vault
    let vault_address = vault.key();
    let authority_seed = &[vault_address.as_ref()];
    let (authority, bump) = Pubkey::find_program_address(authority_seed, ctx.program_id);

    // record vault's state
    vault.farm = farm.key();
    vault.owner = ctx.accounts.owner.key();
    vault.authority = authority;
    vault.authority_seed = vault_address;
    vault.authority_bump_seed = [bump];

    msg!("new vault founded by {}", &ctx.accounts.owner.key());
    Ok(())
}
