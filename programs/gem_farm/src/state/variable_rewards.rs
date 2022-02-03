use anchor_lang::prelude::*;
use gem_common::*;

use crate::{number128::Number128, state::*};

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize, PartialEq)]
pub struct VariableRateConfig {
    /// total amount of reward
    pub amount: u64,

    /// over which period it's active
    pub duration_sec: u64,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct VariableRateReward {
    /// in tokens/s, = calculated as total reward pot at initialization / reward duration
    pub reward_rate: Number128,

    /// set to upper bound, not just now_ts (except funding, when there is no upper bound)
    pub reward_last_updated_ts: u64,

    /// this is somewhat redundant with total_accrued_to_stakers in funds, but necessary
    /// think of it as a "flag in the ground" that gets moved forward as more rewards accrue to the pool
    /// when a farmer tries to figure out how much they're due from the pool, we:
    /// 1) compare their latest record of flag position, with actual flag position
    /// 2) multiply the difference by the amount they have staked
    /// 3) update their record of flag position, so that next time we don't count this distance again
    pub accrued_reward_per_rarity_point: Number128,
}

impl VariableRateReward {
}
