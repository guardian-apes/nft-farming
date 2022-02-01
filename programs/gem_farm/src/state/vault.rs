use anchor_lang::prelude::*;
use gem_common::{errors::ErrorCode, *};

use crate::{number128::Number128, state::FixedRateSchedule};

#[repr(C)]
#[derive(Debug, Copy, Clone, Default, AnchorSerialize, AnchorDeserialize)]
pub struct VaultFixedRateReward {
    /// this is the time the farmer staked
    /// can be WAY BACK in the past, if we've rolled them multiple times
    pub begin_staking_ts: u64,

    /// this is the time the latest reward schedule they subscribed to begins
    /// (this + promised duration = end_schedule_ts)
    pub begin_schedule_ts: u64,

    /// always set to upper bound, not just now_ts (except funding)
    pub last_updated_ts: u64,

    /// when a farmer stakes with the fixed schedule, at the time of staking,
    /// we promise them a schedule for a certain duration (eg 1 token/rarity point/s for 100s)
    /// that then "reserves" a certain amount of funds so that they can't be promised to other farmers
    /// only if the farmer unstakes, will the reserve be void, and the funds become available again
    /// for either funding other farmers or withdrawing (when the reward is cancelled)
    pub promised_schedule: FixedRateSchedule,

    pub promised_duration: u64,
}

impl VaultFixedRateReward {
    /// accrued to rolled stakers, whose begin_staking_ts < begin_schedule_ts
    pub fn loyal_staker_bonus_time(&self) -> Result<u64, ProgramError> {
        self.begin_schedule_ts.try_sub(self.begin_staking_ts)
    }

    pub fn end_schedule_ts(&self) -> Result<u64, ProgramError> {
        self.begin_schedule_ts.try_add(self.promised_duration)
    }

    pub fn is_staked(&self) -> bool {
        // these get zeroed out when farmer graduates
        self.begin_staking_ts > 0 && self.begin_schedule_ts > 0
    }

    pub fn is_time_to_graduate(&self, now_ts: u64) -> Result<bool, ProgramError> {
        Ok(now_ts >= self.end_schedule_ts()?)
    }

    pub fn reward_upper_bound(&self, now_ts: u64) -> Result<u64, ProgramError> {
        Ok(std::cmp::min(now_ts, self.end_schedule_ts()?))
    }

    pub fn time_from_staking_to_update(&self) -> Result<u64, ProgramError> {
        self.last_updated_ts.try_sub(self.begin_staking_ts)
    }

    /// (!) intentionally uses begin_staking_ts for both start_from and end_at
    /// in doing so we increase both start_from and end_at by exactly loyal_staker_bonus_time
    pub fn voided_reward(&self, rarity_points: u64) -> Result<u64, ProgramError> {
        let start_from = self.time_from_staking_to_update()?;
        let end_at = self.end_schedule_ts()?.try_sub(self.begin_staking_ts)?;

        self.promised_schedule
            .reward_amount(start_from, end_at, rarity_points)
    }

    /// (!) intentionally uses begin_staking_ts for both start_from and end_at
    /// in doing so we increase both start_from and end_at by exactly loyal_staker_bonus_time
    pub fn newly_accrued_reward(
        &self,
        now_ts: u64,
        rarity_points: u64,
    ) -> Result<u64, ProgramError> {
        let start_from = self.time_from_staking_to_update()?;
        let end_at = self
            .reward_upper_bound(now_ts)?
            .try_sub(self.begin_staking_ts)?;

        self.promised_schedule
            .reward_amount(start_from, end_at, rarity_points)
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct VaultVariableRateReward {
    /// used to keep track of how much of the variable reward has been updated for this farmer
    /// (read more in variable rate config)
    pub last_recorded_accrued_reward: Number128,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct VaultReward {
    /// total, not per rarity point. Never goes down (ie is cumulative)
    pub paid_out_reward: u64,

    /// total, not per rarity point. Never goes down (ie is cumulative)
    pub accrued_reward: u64,

    /// only one of these two (fixed and variable) will actually be used, per reward
    pub variable_rate: VaultVariableRateReward,

    pub fixed_rate: VaultFixedRateReward,
}

#[repr(C)]
#[account]
pub struct Vault {
    /// each vault is registered with a single farm, used for indexing
    pub farm: Pubkey,

    /// responsible for signing deposits / withdrawals into the vault
    /// (!) NOTE: does NOT un/lock the vault - the farm manager does that
    /// can update itself to another Pubkey
    pub owner: Pubkey,

    /// pubkey used to create the vault, baked into vault's PDA - NOT CHANGEABLE
    pub creator: Pubkey,

    /// signs off on any token transfers out of the gem boxes controlled by the vault
    pub authority: Pubkey,

    pub authority_seed: Pubkey,

    pub authority_bump_seed: [u8; 1],

    pub name: [u8; 32],

    /// after depositing one gem, we'll set locked to true. This vault can no longer be used to deposit gems. 
    /// one gem, one vault
    pub locked: bool,

    /// Store the mint of the gem in here. just for convenience of fetching vault data
    pub gem_mint: Pubkey,

    // ----------------- rewards
    pub reward_a: VaultReward,

    pub reward_b: VaultReward,
}

impl Vault {
    pub fn vault_seeds(&self) -> [&[u8]; 2] {
        [self.authority_seed.as_ref(), &self.authority_bump_seed]
    }

    pub fn access_suspended(&self) -> Result<bool, ProgramError> {
        if self.locked {
            return Ok(true);
        }

        Ok(false)
    }
}
