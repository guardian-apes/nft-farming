use anchor_lang::prelude::*;
use gem_common::{errors::ErrorCode, *};

use crate::state::*;

pub const LATEST_FARM_VERSION: u16 = 0;

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FarmConfig {
    pub paper_hands_tax_lamp: u64,
}

#[repr(C)]
#[account]
#[derive(Debug)]
pub struct Farm {
    pub version: u16,

    /// authorizes funders, whitelists mints/creators, sets farm config params
    /// can update itself to another Pubkey
    pub farm_manager: Pubkey,

    /// used for collecting any fees earned by the farm
    pub farm_treasury: Pubkey,

    /// signs off on treasury payouts and on any operations related to the bank
    /// (configured as bank manager)
    pub farm_authority: Pubkey,

    pub farm_authority_seed: Pubkey,

    pub farm_authority_bump_seed: [u8; 1],

    pub config: FarmConfig,

    /// how many accounts can create funding schedules
    pub authorized_funder_count: u64,

    // ----------------- rewards
    pub reward_a: FarmReward,

    /// only gems allowed will be those that have EITHER a:
    /// 1) creator from this list
    pub whitelisted_creators: u32,

    /// total vault count registered with this bank
    pub vault_count: u64,
}

impl Farm {
    pub fn farm_seeds(&self) -> [&[u8]; 2] {
        [
            self.farm_authority_seed.as_ref(),
            &self.farm_authority_bump_seed,
        ]
    }

    pub fn fund_reward(&mut self, amount: u64) -> ProgramResult {
        self.reward_a.funds.total_funded.try_add_assign(amount)?;

        Ok(())
    }

    pub fn reserve_rewards(
        &mut self,
        vault: &mut Vault,
        now: u64,
        reward_a_tier_config: Option<TierConfig>,
    ) -> ProgramResult {
        // Immediately add vault count on this farm.
        self.vault_count.try_add_assign(1)?;

        // let's ignore reward b for now and focus on reward a
        vault.reward_a.staked_at = now;
        vault.reward_a.last_rewards_claimed_at = now;

        if reward_a_tier_config.is_some() {
            vault.reward_a.reward_tier = reward_a_tier_config.unwrap();
        } else {
            vault.reward_a.reward_tier = self.reward_a.fixed_rate.schedule.tier0;
        }

        let tier = vault.reward_a.reward_tier;

        // be sure to divide by denominator
        let reserved_amount = tier
            .reward_rate
            .try_div(self.reward_a.fixed_rate.schedule.denominator)?
            .try_mul(tier.required_tenure)?;

        msg!(
            "Funded amount in rewards, {}",
            self.reward_a.funds.pending_amount()?
        );
        // check the farm funds. we need to have the reserved rewards in farm fund
        if reserved_amount > self.reward_a.funds.pending_amount()? {
            return Err(ErrorCode::InsufficientFunding.into());
        }

        vault.reward_a.reserved_amount = reserved_amount;

        // update farm reserves
        self.reward_a
            .funds
            .total_accrued_to_stakers
            .try_add_assign(reserved_amount)?;

        Ok(())
    }

    pub fn update_staked_count(&mut self) -> ProgramResult {
        // record number of vaults on farm
        self.vault_count.try_add_assign(1)?;

        Ok(())
    }

    pub fn unreserve_rewards(&mut self, vault: &mut Vault, now: u64) -> ProgramResult {
        // amount we unreserve is total paid out + any outstanding rewards to be paid out
        let unreserve_amount = vault.reward_a.paid_out_reward.try_add(
            vault
                .reward_a
                .outstanding_reward(now, self.reward_a.fixed_rate.schedule.denominator)?,
        )?;

        self.reward_a
            .funds
            .total_accrued_to_stakers
            .try_sub_assign(unreserve_amount)?;

        // since we're here let's be sure to reduce the number of vaults on the farm
        self.vault_count.try_sub_assign(1)?;

        Ok(())
    }
}

// --------------------------------------- farm reward

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize, PartialEq)]
pub enum RewardType {
    Variable,
    Fixed,
}

/// these numbers should only ever go up - ie they are cummulative
#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FundsTracker {
    pub total_funded: u64,

    pub total_refunded: u64,

    pub total_accrued_to_stakers: u64,
}

impl FundsTracker {
    pub fn pending_amount(&self) -> Result<u64, ProgramError> {
        self.total_funded
            .try_sub(self.total_refunded)?
            .try_sub(self.total_accrued_to_stakers)
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TimeTracker {
    /// total duration for which the reward has been funded
    /// updated with each new funding round
    pub duration_sec: u64,

    pub reward_end_ts: u64,

    /// this will be set = to reward_end_ts if farm manager decides to lock up their reward
    /// gives stakers the certainty it won't be withdrawn
    pub lock_end_ts: u64,
}

impl TimeTracker {}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FarmReward {
    /// in v0 the next 3 fields (mint, pot type) are set ONLY once, at farm init
    ///   and can't ever be changed for security reasons
    ///   potentially in v1++ might find a way around it, but for now just use a new farm
    pub reward_mint: Pubkey,

    /// where the reward is stored
    pub reward_pot: Pubkey,

    pub reward_type: RewardType,

    /// only one of these two (fixed and variable) will actually be used, per reward
    pub fixed_rate: FixedRateReward,

    pub funds: FundsTracker,

    pub times: TimeTracker,
}

impl FarmReward {}
