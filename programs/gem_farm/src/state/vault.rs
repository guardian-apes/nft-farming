use anchor_lang::prelude::*;
use gem_common::{errors::ErrorCode, *};

use crate::state::*;

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct VaultReward {
    pub paid_out_reward: u64,

    pub staked_at: u64,

    pub reserved_amount: u64,

    pub reward_tier: TierConfig,

    pub last_rewards_claimed_at: u64,
}

impl VaultReward {
    pub fn outstanding_reward(&self, now: u64, denominator: u64) -> Result<u64, ProgramError> {
        // if the required tenure is zero (meaning we're on tier0, we simply calculate and return rewards up to this moment)

        // if staking period is over
        let tenure_expiry = self.staked_at.try_add(self.reward_tier.required_tenure)?;

        msg!("calculated tenure expiry of {}", tenure_expiry);
        msg!("self.last_rewards_claimed_at of {}", self.last_rewards_claimed_at);

        // check if staking period is not over, or user is on tier0. in both cases, compute unclaimed rewards and send along
        if now < tenure_expiry || self.reward_tier.required_tenure == 0 {
            // this means the farmer is claiming rewards before the lock period is over
            let unclaimed_rewards_time = now.try_sub(self.last_rewards_claimed_at)?;

            msg!("calculated unclaimed_rewards_time of {}", unclaimed_rewards_time);

            let outstanding_rewards =
                unclaimed_rewards_time.try_mul(self.computed_reward_rate(denominator)?)?;

            return Ok(outstanding_rewards);
        }

        // in some scenarios, the last_rewards_claimed_at might be more than expiry
        // in a unique situation where a farmer claimed tokens before expiry
        // this claim sets the last_rewards_claimed_at
        // after expiry the farmer attempts to claim again, which works
        // and sets the last_rewards_claimed_at to after expiry time
        // but the next claim is going to have some problems, because the
        // last_rewards_claimed_at is now more than tenure_expiry and we cannot subtract them anymore
        if self.last_rewards_claimed_at > tenure_expiry {
            msg!("self.last_rewards_claimed_at of {} vs tenure expiry of {} resulted in zero tokens to claim", self.last_rewards_claimed_at, tenure_expiry);
            // this is a scenario where the user has claimed tokens after expiry.
            // meaning they have nothing else to claim
            // so we return zero
            return Ok(0);
        }

        let unclaimed_rewards_time = tenure_expiry.try_sub(self.last_rewards_claimed_at)?;

        let outstanding_reward = unclaimed_rewards_time.try_mul(self.reward_tier.reward_rate)?;

        msg!("unclaimed_rewards_time calculated as {}", unclaimed_rewards_time);

        Ok(outstanding_reward.try_div(denominator)?)
    }

    pub fn computed_reward_rate(&self, denominator: u64) -> Result<u64, ProgramError> {
        let computed_rate = self.reward_tier.reward_rate.try_div(denominator)?;
        msg!("Computed reward rate of {} from a denominator of {} and reward tier rate of {}", computed_rate, denominator, self.reward_tier.reward_rate);

        Ok(computed_rate)
    }

    pub fn claim_rewards(
        &mut self,
        pot_balance: u64,
        now: u64,
        denominator: u64,
    ) -> Result<u64, ProgramError> {
        let outstanding = self.outstanding_reward(now, denominator)?;

        msg!("calculated outstanding rewards of {} ", outstanding);

        // if we currently can't pay the funder, let's throw an error
        if outstanding > pot_balance {
            return Err(ErrorCode::InsufficientFunding.into());
        }

        self.last_rewards_claimed_at = now;
        self.paid_out_reward.try_add_assign(outstanding)?;

        Ok(outstanding)
    }
}

#[repr(C)]
#[account]
pub struct Vault {
    /// each vault is registered with a single farm, used for indexing
    pub farm: Pubkey,

    pub owner: Pubkey,

    /// signs off on any token transfers out of the gem boxes controlled by the vault
    pub authority: Pubkey,

    pub authority_seed: Pubkey,

    pub authority_bump_seed: [u8; 1],

    /// after depositing one gem, we'll set locked to true. This vault can no longer be used to deposit gems.
    /// one gem, one vault
    pub locked: bool,

    /// Store the mint of the gem in here. just for convenience of fetching vault data
    pub gem_mint: Pubkey,

    // ----------------- rewards
    pub reward_a: VaultReward,
}

impl Vault {
    pub fn vault_seeds(&self) -> [&[u8]; 2] {
        [self.authority_seed.as_ref(), &self.authority_bump_seed]
    }

    pub fn attempting_to_break_bank(&self, now: u64) -> Result<bool, ProgramError> {
        // add tier required tenure to time staking started
        let time_since_staked = self
            .reward_a
            .reward_tier
            .required_tenure
            .try_add(self.reward_a.staked_at)?;

        if now > time_since_staked {
            return Ok(false);
        }

        Ok(true)
    }

    pub fn access_suspended(&self) -> Result<bool, ProgramError> {
        if self.locked {
            return Ok(true);
        }

        Ok(false)
    }
}
