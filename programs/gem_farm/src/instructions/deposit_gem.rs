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

fn assert_valid_whitelist_proof<'info>(
    whitelist_proof: &AccountInfo<'info>,
    farm: &Pubkey,
    address_to_whitelist: &Pubkey,
    program_id: &Pubkey,
    expected_whitelist_type: WhitelistType,
) -> ProgramResult {
    // 1 verify the PDA seeds match
    let seed = &[
        b"whitelist".as_ref(),
        farm.as_ref(),
        address_to_whitelist.as_ref(),
    ];
    let (whitelist_addr, _bump) = Pubkey::find_program_address(seed, program_id);

    // we can't use an assert_eq statement, we want to catch this error and continue along to creator testing
    if whitelist_addr != whitelist_proof.key() {
        return Err(ErrorCode::NotWhitelisted.into());
    }

    // 2 no need to verify ownership, deserialization does that for us
    // https://github.com/project-serum/anchor/blob/fcb07eb8c3c9355f3cabc00afa4faa6247ccc960/lang/src/account.rs#L36
    let proof = Account::<'info, WhitelistProof>::try_from(whitelist_proof)?;

    // 3 verify whitelist type matches
    proof.contains_type(expected_whitelist_type)
}

fn assert_whitelisted(ctx: &Context<DepositGem>) -> ProgramResult {
    let farm = &*ctx.accounts.farm;
    let mint = &*ctx.accounts.gem_mint;
    let remaining_accs = &mut ctx.remaining_accounts.iter();

    // if mint verification above failed, attempt to verify based on creator
    if farm.whitelisted_creators > 0 {
        // 2 additional accounts are expected - metadata and creator whitelist proof
        let metadata_info = next_account_info(remaining_accs)?;
        let creator_whitelist_proof_info = next_account_info(remaining_accs)?;

        // verify metadata is legit
        let metadata = assert_valid_metadata(metadata_info, &mint.key())?;

        // metaplex constraints this to max 5, so won't go crazy on compute
        // (empirical testing showed there's practically 0 diff between stopping at 0th and 5th creator)
        for creator in &metadata.data.creators.unwrap() {
            // verify creator actually signed off on this nft
            if !creator.verified {
                continue;
            }

            // check if creator is whitelisted, returns an error if not
            let attempted_proof = assert_valid_whitelist_proof(
                creator_whitelist_proof_info,
                &farm.key(),
                &creator.address,
                ctx.program_id,
                WhitelistType::CREATOR,
            );

            match attempted_proof {
                //proof succeeded, return out of the function, no need to continue looping
                Ok(()) => return Ok(()),
                //proof failed, continue to check next creator
                Err(_e) => continue,
            }
        }
    }

    // if both conditions above failed tok return Ok(()), then verification failed
    Err(ErrorCode::NotWhitelisted.into())
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

    if farm.whitelisted_creators > 0 {
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
