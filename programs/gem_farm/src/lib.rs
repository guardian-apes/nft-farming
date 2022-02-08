use anchor_lang::prelude::*;
use instructions::*;
use state::*;

pub mod instructions;
pub mod number128;
pub mod state;

declare_id!("DzRXhhpFKwJ8K6GjQjqLcxF9nxF1p8cDsxjsFWhYYJwV");

#[program]
pub mod gem_farm {
    use super::*;

    // --------------------------------------- core

    pub fn init_farm(
        ctx: Context<InitFarm>,
        bump_auth: u8,
        _bump_treasury: u8,
        _bump_pot_a: u8,
        reward_type_a: RewardType,
        reward_a_fixed_reward_schedule: Option<FixedRateSchedule>,
        farm_config: FarmConfig,
    ) -> ProgramResult {
        msg!("init farm");
        instructions::init_farm::handler(
            ctx,
            bump_auth,
            reward_type_a,
            reward_a_fixed_reward_schedule,
            farm_config
        )
    }

    pub fn update_farm(
        ctx: Context<UpdateFarm>,
        config: Option<FarmConfig>,
        manager: Option<Pubkey>,
    ) -> ProgramResult {
        instructions::update_farm::handler(ctx, config, manager)
    }

    pub fn fund_reward(
        ctx: Context<FundReward>,
        _bump_proof: u8,
        _bump_pot: u8,
        amount: u64
    ) -> ProgramResult {
        instructions::fund_reward::handler(ctx, amount)
    }

    pub fn whitelist_creator(
        ctx: Context<WhiteListCreator>,
        _bump: u8,
    ) -> ProgramResult {
        instructions::whitelist_creator::handler(ctx)
    }

    pub fn payout_from_treasury(
        ctx: Context<TreasuryPayout>,
        _bump_auth: u8,
        bump_treasury: u8,
        lamports: u64,
    ) -> ProgramResult {
        msg!("payout");
        instructions::treasury_payout::handler(ctx, bump_treasury, lamports)
    }

    // --------------------------------------- farmer ops

    pub fn deposit_gem(
        ctx: Context<DepositGem>,
        _bump_auth: u8,
        _bump_gem_box: u8,
        reward_a_tier_config: Option<TierConfig>,
    ) -> ProgramResult {
        instructions::deposit_gem::handler(ctx, reward_a_tier_config)
    }

    pub fn withdraw_gem(
        ctx: Context<WithdrawGem>,
        _bump_farm_auth: u8,
        _bump_treasury: u8,
        _bump_vault_auth: u8,
        _bump_gem_box: u8,
        _bump_pot_a: u8
    ) -> ProgramResult {
        instructions::withdraw_gem::handler(ctx)
    }

    pub fn init_vault(
        ctx: Context<InitVault>,
        _bump: u8
    ) -> ProgramResult {
        instructions::init_vault::handler(ctx)
    }

    // --------------------------------------- funder ops

    pub fn authorize_funder(ctx: Context<AuthorizeFunder>, _bump: u8) -> ProgramResult {
        msg!("authorize funder");
        instructions::authorize_funder::handler(ctx)
    }

    pub fn deauthorize_funder(ctx: Context<DeauthorizeFunder>, _bump: u8) -> ProgramResult {
        msg!("feauthorize funder");
        instructions::deauthorize_funder::handler(ctx)
    }

    pub fn claim_rewards(
        ctx: Context<ClaimReward>,
        _bump_auth: u8,
        _bump_farmer: u8,
        _bump_pot_a: u8,
    ) -> ProgramResult {
        instructions::claim_rewards::handler(ctx)
    }
}
