use anchor_lang::prelude::*;
use gem_common::errors::ErrorCode;

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum FixedRateRewardTier {
    Tier0,
    Tier1,
    Tier2,
    Tier3,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TierConfig {
    pub reward_rate: u64, // this value will be how much we want to reward per day
    // we'll pass a denominator of 86,400 if we wanted to slow this down.
    // say we want to reward 10 $eGARD per day.
    // we'll store reward_rate as 10, and denominator as 86,400
    // next, say we wanted this reward to come with a staking period of 60 days.
    // we'll store required_tenure as 60*86400 = 5,184,000.
    // The total amount reserved from the farm funds will be (reward_rate / denominator) * required_tenure
    // which will equal 600, resulting in the initial 60 days staking * 10 per day.
    /// lock duration to earn the above reward rate
    pub required_tenure: u64, // we'll save this value in seconds. so 60 days will be 60 * 86400 stored here.
}

impl Default for TierConfig {
    fn default() -> Self {
        Self {
            reward_rate: 0,
            required_tenure: 0,
        }
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FixedRateSchedule {
    /// tokens/denominator / sec
    pub tier0: TierConfig,

    pub tier1: Option<TierConfig>,

    pub tier2: Option<TierConfig>,

    pub tier3: Option<TierConfig>,

    /// needed to slow down the payout schedule (else min would be 1 token/rarity point/s or 86k/rarity point/day
    /// only used in fixed rate - in variable overall duration serves as sufficient speed regulator  
    pub denominator: u64,
}

/// custom impl coz need the discriminator to be 1 by default, else get div /0 errors
impl Default for FixedRateSchedule {
    fn default() -> Self {
        Self {
            tier0: TierConfig {
                reward_rate: 0,     // default reward rate is 0.
                required_tenure: 0, // reward tenure for tier0 is always 0. gems on this tier can stake and unstake anytime
            },
            tier1: None,
            tier2: None,
            tier3: None,
            denominator: 1,
        }
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FixedRateConfig {
    pub schedule: FixedRateSchedule,
}

impl FixedRateSchedule {
    pub fn verify_schedule_invariants(&self) {
        if let Some(t3) = self.tier3 {
            // later tiers require earlier tiers to be present (no gaps)
            assert!(self.tier2.is_some() && self.tier1.is_some());

            // later tenures must be further into the future than earlier tenures
            let t2_tenure = self.tier2.unwrap().required_tenure;
            assert!(t3.required_tenure >= t2_tenure);

            let t1_tenure = self.tier1.unwrap().required_tenure;
            assert!(t2_tenure >= t1_tenure);
        };

        if let Some(t2) = self.tier2 {
            // later tiers require earlier tiers to be present (no gaps)
            assert!(self.tier1.is_some());

            // later tenures must be further into the future than earlier tenures
            let t1_tenure = self.tier1.unwrap().required_tenure;
            assert!(t2.required_tenure >= t1_tenure);
        };

        assert!(self.tier0.required_tenure == 0);

        // denominator can't be 0
        assert_ne!(self.denominator, 0);
    }

    pub fn assert_valid_tier_config(&self, tier: TierConfig) -> ProgramResult {
        if self.tier1.is_some() {
            let tier1 = self.tier1.unwrap();

            if tier1.reward_rate == tier.reward_rate
                && tier1.required_tenure == tier.required_tenure
            {
                return Ok(());
            }
        }

        if self.tier2.is_some() {
            let tier2 = self.tier2.unwrap();

            if tier2.reward_rate == tier.reward_rate
                && tier2.required_tenure == tier.required_tenure
            {
                return Ok(());
            }
        }

        if self.tier3.is_some() {
            let tier3 = self.tier3.unwrap();

            if tier3.reward_rate == tier.reward_rate
                && tier3.required_tenure == tier.required_tenure
            {
                return Ok(());
            }
        }

        Err(ErrorCode::InvalidTierConfig.into())
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FixedRateReward {
    /// configured on funding
    pub schedule: FixedRateSchedule,

    /// amount that has been promised to existing stakers and hence can't be withdrawn
    pub reserved_amount: u64,
}

impl FixedRateReward {
    pub fn new(schedule: FixedRateSchedule) -> Self {
        Self {
            schedule,
            reserved_amount: 0, // all farms start with zero funded.
        }
    }
}
