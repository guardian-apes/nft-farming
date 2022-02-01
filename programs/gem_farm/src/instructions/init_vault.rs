use std::io::Write;

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
            creator.key().as_ref(),
        ],
        bump = bump,
        payer = payer,
        space = 8 + std::mem::size_of::<Vault>())]
    pub vault: Box<Account<'info, Vault>>,
    pub creator: Signer<'info>,

    // misc
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitVault>, owner: Pubkey, name: String) -> ProgramResult {
    // record total number of vaults in farm's state
    let farm = &mut ctx.accounts.farm;
    let vault = &mut ctx.accounts.vault;

    farm.vault_count.try_add_assign(1)?;

    // derive the authority responsible for all token transfers within the new vault
    let vault_address = vault.key();
    let authority_seed = &[vault_address.as_ref()];
    let (authority, bump) = Pubkey::find_program_address(authority_seed, ctx.program_id);

    // record vault's state
    vault.farm = farm.key();
    vault.owner = owner;
    vault.creator = ctx.accounts.creator.key();
    vault.authority = authority;
    vault.authority_seed = vault_address;
    vault.authority_bump_seed = [bump];

    // init rewards on vault
    vault.reward_a.fixed_rate.promised_schedule = FixedRateSchedule::default(); //denom to 1
    vault.reward_b.fixed_rate.promised_schedule = FixedRateSchedule::default(); //denom to 1

    (&mut vault.name[..]).write_all(name.as_bytes())?;

    msg!("new vault founded by {}", &ctx.accounts.creator.key());
    Ok(())
}
