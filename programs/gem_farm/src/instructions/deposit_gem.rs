use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use gem_common::{errors::ErrorCode, *};
use metaplex_token_metadata::state::Metadata;

use crate::state::*;

#[derive(Accounts)]
#[instruction(bump_auth: u8, bump_gem_box: u8)]
pub struct DepositGem<'info> {
    // farm
    #[account(mut)]
    pub farm: Box<Account<'info, Farm>>,

    // vault
    // skipped vault PDA verification because requires passing in creator, which is tedious
    // sec wise secure enough: vault has owner -> owner is signer
    #[account(mut, has_one = farm, has_one = owner, has_one = authority)]
    pub vault: Box<Account<'info, Vault>>,
    // currently only the vault owner can deposit
    // add a "depositor" account, and remove Signer from vault owner to let anyone to deposit
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [vault.key().as_ref()], bump = bump_auth)]
    pub authority: AccountInfo<'info>,

    // gem
    #[account(init_if_needed, seeds = [
            b"gem_box".as_ref(),
            vault.key().as_ref(),
        ],
        bump = bump_gem_box,
        token::mint = gem_mint,
        token::authority = authority,
        payer = owner)]
    pub gem_box: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub gem_source: Box<Account<'info, TokenAccount>>,
    pub gem_mint: Box<Account<'info, Mint>>,

    // misc
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    //
    // remaining accounts could be passed, in this order:
    // - mint_whitelist_proof
    // - gem_metadata <- if we got to this point we can assume gem = NFT, not a fungible token
    // - creator_whitelist_proof
}

impl<'info> DepositGem<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.gem_source.to_account_info(),
                to: self.gem_box.to_account_info(),
                authority: self.owner.to_account_info(),
            },
        )
    }
}

fn assert_valid_metadata(
    gem_metadata: &AccountInfo,
    gem_mint: &Pubkey,
) -> Result<Metadata, ProgramError> {
    let metadata_program = Pubkey::from_str("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").unwrap();

    // 1 verify the owner of the account is metaplex's metadata program
    assert_eq!(gem_metadata.owner, &metadata_program);

    // 2 verify the PDA seeds match
    let seed = &[
        b"metadata".as_ref(),
        metadata_program.as_ref(),
        gem_mint.as_ref(),
    ];

    let (metadata_addr, _bump) = Pubkey::find_program_address(seed, &metadata_program);
    assert_eq!(metadata_addr, gem_metadata.key());

    Metadata::from_account_info(gem_metadata)
}

fn assert_whitelisted(ctx: &Context<DepositGem>) -> ProgramResult {
    let farm = &*ctx.accounts.farm;
    let mint = &*ctx.accounts.gem_mint;
    let remaining_accs = &mut ctx.remaining_accounts.iter();

    // we expect only one remaining account, which is the metadata info
    let metadata_info = next_account_info(remaining_accs)?;

    // verify metadata is legit
    let metadata = assert_valid_metadata(metadata_info, &mint.key())?;

    let whitelisted_candy_machine = farm.config.whitelisted_candy_machine.unwrap();

    let creators = &metadata.data.creators.unwrap();

    let on_chain_candy_machine = creators.first().unwrap();

    if whitelisted_candy_machine.key() != on_chain_candy_machine.address {
        return Err(ErrorCode::NotWhitelisted.into());
    }

    Ok(())
}

pub fn handler(
    ctx: Context<DepositGem>,
    reward_a_tier_config: Option<TierConfig>,
) -> ProgramResult {
    // if even a single whitelist exists, verify the token against it
    let farm = &*ctx.accounts.farm;
    let vault = &*ctx.accounts.vault;

    let now = now_ts()?;

    if vault.access_suspended()? {
        return Err(ErrorCode::VaultAccessSuspended.into());
    }

    // Verify the candy machine for the gem about to be deposited is whitelisted.
    if farm.config.whitelisted_candy_machine.is_some() {
        assert_whitelisted(&ctx)?;
    }

    // validate tier_config for fixed reward types.
    // if no tier config was passed, then we use tier0
    if matches!(farm.reward_a.reward_type, RewardType::Fixed) && reward_a_tier_config.is_some() {
        farm.reward_a
            .fixed_rate
            .schedule
            .assert_valid_tier_config(reward_a_tier_config.unwrap())?;
    }

    // do the transfer
    token::transfer(
        ctx.accounts
            .transfer_ctx()
            .with_signer(&[&vault.vault_seeds()]),
        1, // its an nft. it's always gonna be 1.
    )?;

    let farm = &mut ctx.accounts.farm;
    let vault = &mut ctx.accounts.vault;
    let gem_box = &*ctx.accounts.gem_box;

    // 1. calculate how much we're reserving for this deposited gem
    // 2. record that amount on the farm reward (rewardA and rewardB)
    // 3. record the deposit time
    // 4. record the deposit tier the user selected
    farm.reserve_rewards(vault, now, reward_a_tier_config)?;

    // record the gem on vault and lock the vault
    vault.locked = true;
    vault.gem_mint = gem_box.mint;

    Ok(())
}
