pub mod authorize_funder;
pub mod deauthorize_funder;
pub mod init_farm;
pub mod treasury_payout;
pub mod update_farm;
pub mod deposit_gem;
pub mod init_vault;
pub mod fund_reward;
pub mod claim_rewards;

pub use authorize_funder::*;
pub use deauthorize_funder::*;
pub use init_farm::*;
pub use treasury_payout::*;
pub use update_farm::*;
pub use deposit_gem::*;
pub use init_vault::*;
pub use fund_reward::*;
pub use claim_rewards::*;

// have to duplicate or this won't show up in IDL
use anchor_lang::prelude::*;
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq)]
pub struct RarityConfig {
    pub mint: Pubkey,
    pub rarity_points: u16,
}
