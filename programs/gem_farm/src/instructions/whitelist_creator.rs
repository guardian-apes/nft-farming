use anchor_lang::prelude::*;
use gem_common::*;

use crate::state::*;

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct WhiteListCreator<'info> {
    // farm
    #[account(mut, has_one = farm_manager)]
    pub farm: Box<Account<'info, Farm>>,
    #[account(mut)]
    pub farm_manager: Signer<'info>,

    // funder
    pub creator_to_whitelist: AccountInfo<'info>,
    #[account(init_if_needed, seeds = [
            b"whitelist".as_ref(),
            farm.key().as_ref(),
            creator_to_whitelist.key().as_ref(),
        ],
        bump = bump,
        payer = farm_manager,
        space = 8 + std::mem::size_of::<WhitelistProof>())]
    whitelist_proof: Box<Account<'info, WhitelistProof>>,

    // misc
    system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WhiteListCreator>) -> ProgramResult {
    // create/update whitelist proof
    let proof = &mut ctx.accounts.whitelist_proof;

    proof.whitelisted_address = ctx.accounts.creator_to_whitelist.key();
    proof.farm = ctx.accounts.farm.key();

    // update farm
    let farm = &mut ctx.accounts.farm;

    farm.whitelisted_creators.try_add_assign(1)?;

    msg!(
        "creator whitelisted: {}",
        ctx.accounts.creator_to_whitelist.key()
    );
    Ok(())
}
