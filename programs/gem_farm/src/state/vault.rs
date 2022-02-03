use anchor_lang::prelude::*;
use gem_common::{errors::ErrorCode, *};

use crate::{number128::Number128, state::*};

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
    pub fn outstanding_reward(&self, now: u64) -> Result<u64, ProgramError> {
        let unclaimed_rewards_time = now.try_sub(self.last_rewards_claimed_at)?;

        let outstanding_reward = unclaimed_rewards_time.try_mul(self.reward_tier.reward_rate)?;

        Ok(outstanding_reward)
    }

    pub fn claim_rewards(&mut self, pot_balance: u64, now: u64) -> Result<u64, ProgramError> {
        let outstanding = self.outstanding_reward(now)?;

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

    pub fn access_suspended(&self) -> Result<bool, ProgramError> {
        if self.locked {
            return Ok(true);
        }

        Ok(false)
    }
}
