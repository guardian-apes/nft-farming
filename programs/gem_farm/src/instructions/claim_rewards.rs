use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use gem_common::*;

use crate::state::*;

#[derive(Accounts)]
#[instruction(bump_auth: u8, bump_vault: u8, bump_pot_a: u8)]
pub struct ClaimReward<'info> {
    // farm
    #[account(mut, has_one = farm_authority)]
    pub farm: Box<Account<'info, Farm>>,

    #[account(seeds = [farm.key().as_ref()], bump = bump_auth)]
    pub farm_authority: AccountInfo<'info>,

    // vault
    #[account(mut, has_one = farm, has_one = owner, seeds = [
            b"vault".as_ref(),
            farm.key().as_ref(),
            owner.key().as_ref(),
            gem_mint.key().as_ref(),
        ],
        bump = bump_vault)]
    pub vault: Box<Account<'info, Vault>>,

    pub gem_mint: Box<Account<'info, Mint>>,

    #[account(mut)] //payer
    pub owner: Signer<'info>,

    // reward a
    #[account(mut, seeds = [
            b"reward_pot".as_ref(),
            farm.key().as_ref(),
            reward_a_mint.key().as_ref(),
        ],
        bump = bump_pot_a)]
    pub reward_a_pot: Box<Account<'info, TokenAccount>>,

    pub reward_a_mint: Box<Account<'info, Mint>>,

    #[account(init_if_needed,
        associated_token::mint = reward_a_mint,
        associated_token::authority = owner,
        payer = owner)]
    pub reward_a_destination: Box<Account<'info, TokenAccount>>,

    // misc
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> ClaimReward<'info> {
    fn transfer_a_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.reward_a_pot.to_account_info(),
                to: self.reward_a_destination.to_account_info(),
                authority: self.farm_authority.to_account_info(),
            },
        )
    }
}

pub fn handler(ctx: Context<ClaimReward>) -> ProgramResult {
    // update accrued rewards before claiming
    let vault = &mut ctx.accounts.vault;

    let now = now_ts()?;

    // calculate claimed amounts (capped at what's available in the pot)
    let to_claim_a = vault
        .reward_a
        .claim_rewards(ctx.accounts.reward_a_pot.amount, now)?;

    // // do the transfers
    if to_claim_a > 0 {
        token::transfer(
            ctx.accounts
                .transfer_a_ctx()
                .with_signer(&[&ctx.accounts.farm.farm_seeds()]),
            to_claim_a,
        )?;
    }

    Ok(())
}
