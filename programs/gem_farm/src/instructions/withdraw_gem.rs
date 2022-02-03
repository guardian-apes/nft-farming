use anchor_lang::{
    prelude::*, solana_program::{
        program::invoke, system_instruction
    }
};

use anchor_spl::{
    associated_token::*,
    token::{self, Mint, Token, TokenAccount, Transfer, CloseAccount}
};

use gem_common::{errors::ErrorCode, *};

use crate::state::*;

#[derive(Accounts)]
#[instruction(bump_farm_auth: u8, bump_treasury: u8, bump_vault_auth: u8, bump_gem_box: u8, bump_pot_a: u8)]
pub struct WithdrawGem<'info> {
    #[account(mut)]
    pub farm: Box<Account<'info, Farm>>,

    #[account(seeds = [farm.key().as_ref()], bump = bump_farm_auth)]
    pub farm_authority: AccountInfo<'info>,

    #[account(mut, seeds = [b"treasury".as_ref(), farm.key().as_ref()], bump = bump_treasury)]
    pub farm_treasury: AccountInfo<'info>,

    // vault
    #[account(mut, has_one = farm, has_one = owner, has_one = authority)]
    pub vault: Box<Account<'info, Vault>>,

    // currently only the vault owner can deposit
    // add a "depositor" account, and remove Signer from vault owner to let anyone to deposit
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [vault.key().as_ref()], bump = bump_vault_auth)]
    pub authority: AccountInfo<'info>,

    #[account(mut, seeds = [
        b"gem_box".as_ref(),
        vault.key().as_ref(),
    ],
    bump = bump_gem_box)]
    pub gem_box: Box<Account<'info, TokenAccount>>,

    #[account(init_if_needed,
        associated_token::mint = gem_mint,
        associated_token::authority = owner,
        payer = owner)]
    pub gem_destination: Box<Account<'info, TokenAccount>>,

    // for paying out pending rewards
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

    pub gem_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

impl<'info> WithdrawGem<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.gem_box.to_account_info(),
                to: self.gem_destination.to_account_info(),
                authority: self.authority.to_account_info(),
            },
        )
    }

    fn close_gem_box_ctx(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            CloseAccount {
                account: self.gem_box.to_account_info(),
                destination: self.owner.to_account_info(),
                authority: self.authority.clone(),
            },
        )
    }

    fn close_vault_ctx(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            CloseAccount {
                account: self.gem_box.to_account_info(),
                destination: self.owner.to_account_info(),
                authority: self.authority.clone(),
            },
        )
    }

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

    fn pay_treasury(&self, lamports: u64) -> ProgramResult {
        invoke(
            &system_instruction::transfer(self.owner.key, self.farm_treasury.key, lamports),
            &[
                self.owner.to_account_info(),
                self.farm_treasury.clone(),
                self.system_program.to_account_info(),
            ],
        )
    }
}

pub fn handler(
    ctx: Context<WithdrawGem>,
) -> ProgramResult {
    let farm = &mut ctx.accounts.farm;
    let vault = &mut ctx.accounts.vault;

    // calculate pending rewards on vault and transfer
    let now = now_ts()?;

    if vault.attempting_to_break_bank(now)? {
        // if farmer is breaking bank, it means some reserved rewards should be unreserved
        farm.unreserve_rewards(vault, now)?;

        // if there is a paper hands tax, charge the user
        if farm.config.paper_hands_tax_lamp > 0 {
            let farm = &*ctx.accounts.farm;
            let vault = &*ctx.accounts.vault;

            ctx.accounts.pay_treasury(farm.config.paper_hands_tax_lamp)?;
        } else {
            return Err(ErrorCode::TooEarlyToWithdraw.into());
        }
    }

    let vault = &mut ctx.accounts.vault;

    // calculate claimed amounts (capped at what's available in the pot)
    let to_claim_a = vault
        .reward_a
        .claim_rewards(ctx.accounts.reward_a_pot.amount, now)?;

    // transfer remaining rewards if any
    if to_claim_a > 0 {
        token::transfer(
            ctx.accounts
                .transfer_a_ctx()
                .with_signer(&[&ctx.accounts.farm.farm_seeds()]),
            to_claim_a,
        )?;
    }

    let vault = &ctx.accounts.vault;

    token::transfer(
        ctx.accounts
            .transfer_ctx()
            .with_signer(&[&vault.vault_seeds()]),
        1, // its an nft !
    )?;

    token::close_account(
        ctx.accounts
            .close_gem_box_ctx()
            .with_signer(&[&vault.vault_seeds()]),
    )?;

    token::close_account(
        ctx.accounts
            .close_vault_ctx()
            .with_signer(&[&vault.vault_seeds()]),
    )?;

    Ok(())
}
