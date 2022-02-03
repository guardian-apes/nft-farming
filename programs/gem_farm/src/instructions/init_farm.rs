use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::*;
use gem_common::{errors::ErrorCode};

#[derive(Accounts)]
#[instruction(bump_auth: u8, bump_treasury: u8, bump_pot_a: u8)]
pub struct InitFarm<'info> {
    // farm
    #[account(init, payer = payer, space = 8 + std::mem::size_of::<Farm>())]
    pub farm: Box<Account<'info, Farm>>,

    // Authorized to update the farm
    pub farm_manager: Signer<'info>,

    // We need a farm authority. For example, during the claim instruction, the farm needs to sign off
    // without the manager necessarily being present
    #[account(mut, seeds = [farm.key().as_ref()], bump = bump_auth)]
    pub farm_authority: AccountInfo<'info>,

    #[account(seeds = [b"treasury".as_ref(), farm.key().as_ref()], bump = bump_treasury)]
    pub farm_treasury: AccountInfo<'info>,

    // reward a
    #[account(init, seeds = [
            b"reward_pot".as_ref(),
            farm.key().as_ref(),
            reward_a_mint.key().as_ref(),
        ],
        bump = bump_pot_a,
        token::mint = reward_a_mint,
        token::authority = farm_authority,
        payer = payer)]
    pub reward_a_pot: Box<Account<'info, TokenAccount>>,
    pub reward_a_mint: Box<Account<'info, Mint>>,

    // misc
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitFarm>,
    bump_auth: u8,
    reward_type_a: RewardType,
    // reward configurations
    reward_a_fixed_reward_schedule: Option<FixedRateSchedule>,
    // farm configuration
    farm_config: FarmConfig,
) -> ProgramResult {
    //record new farm details
    let farm = &mut ctx.accounts.farm;

    // let's block variable rewards for now
    if matches!(reward_type_a, RewardType::Variable) {
        return Err(ErrorCode::InvalidRewardType.into())
    }

    // Make sure configurations are valid
    if reward_a_fixed_reward_schedule.is_some() {
        reward_a_fixed_reward_schedule.unwrap().verify_schedule_invariants();
    }

    farm.version = LATEST_FARM_VERSION;
    farm.farm_manager = ctx.accounts.farm_manager.key();
    farm.farm_treasury = ctx.accounts.farm_treasury.key();
    farm.farm_authority = ctx.accounts.farm_authority.key();
    farm.farm_authority_seed = farm.key();
    farm.farm_authority_bump_seed = [bump_auth];
    farm.config = farm_config;

    farm.reward_a.reward_mint = ctx.accounts.reward_a_mint.key();
    farm.reward_a.reward_pot = ctx.accounts.reward_a_pot.key();
    farm.reward_a.reward_type = reward_type_a;

    if matches!(reward_type_a, RewardType::Fixed) {
        farm.reward_a.fixed_rate = FixedRateReward::new(reward_a_fixed_reward_schedule.unwrap());
    }

    msg!("new farm initialized");
    Ok(())
}
