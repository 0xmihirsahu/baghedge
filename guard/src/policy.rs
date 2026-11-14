use crate::crypto::{
    address_word, hash_words, keccak, parse_hex, recover, typed_digest, uint_word,
};
use serde::Deserialize;

const POLICY_TYPE: &str = "HedgePolicy(string environment,bytes32 ruleId,uint32 version,uint64 policyNonce,address tradeAccount,address hedgeAccount,bytes32 watchedSolana,uint8 watchScope,string market,uint32 assetId,string priceSource,address guardAgent,bytes32 guardBuildHash,uint64 capLots,uint64 entryTriggerE8,uint64 entryFloorE8,uint64 recoveryTriggerE8,uint64 buybackCeilingE8,uint64 entryWindowMs,uint64 expiryMs,uint64 minMarginE6,bool oneCycle)";

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Mainnet,
    Testnet,
}

impl Environment {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "mainnet" => Ok(Self::Mainnet),
            "testnet" => Ok(Self::Testnet),
            _ => Err("invalid venue network".into()),
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Mainnet => "mainnet",
            Self::Testnet => "testnet",
        }
    }
}

pub struct Deployment {
    pub owner: [u8; 20],
    pub environment: Environment,
    pub asset_id: u32,
    pub size_decimals: u8,
}

impl Deployment {
    pub fn pinned() -> Result<Self, String> {
        let owner =
            parse_hex(option_env!("BAGHEDGE_PINNED_OWNER").ok_or("guard is not provisioned")?)?;
        let environment = Environment::parse(
            option_env!("BAGHEDGE_PINNED_NETWORK").ok_or("guard is not provisioned")?,
        )?;
        let asset_id = option_env!("BAGHEDGE_PINNED_ASSET_ID")
            .ok_or("guard is not provisioned")?
            .parse()
            .map_err(|_| "invalid pinned asset ID")?;
        let size_decimals = option_env!("BAGHEDGE_PINNED_SIZE_DECIMALS")
            .ok_or("guard is not provisioned")?
            .parse()
            .map_err(|_| "invalid pinned size precision")?;
        if owner == [0; 20] || size_decimals > 6 {
            return Err("invalid guard deployment".into());
        }
        Ok(Self {
            owner,
            environment,
            asset_id,
            size_decimals,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub environment: Environment,
    pub rule_id: String,
    pub version: u32,
    #[serde(deserialize_with = "uint64")]
    pub policy_nonce: u64,
    pub trade_account: String,
    pub hedge_account: String,
    pub watched_solana: String,
    pub watch_scope: u8,
    pub market: String,
    pub asset_id: u32,
    pub price_source: String,
    pub guard_agent: String,
    pub guard_build_hash: String,
    #[serde(deserialize_with = "uint64")]
    pub cap_lots: u64,
    #[serde(deserialize_with = "uint64")]
    pub entry_trigger_e8: u64,
    #[serde(deserialize_with = "uint64")]
    pub entry_floor_e8: u64,
    #[serde(deserialize_with = "uint64")]
    pub recovery_trigger_e8: u64,
    #[serde(deserialize_with = "uint64")]
    pub buyback_ceiling_e8: u64,
    #[serde(deserialize_with = "uint64")]
    pub entry_window_ms: u64,
    #[serde(deserialize_with = "uint64")]
    pub expiry_ms: u64,
    #[serde(deserialize_with = "uint64")]
    pub min_margin_e6: u64,
    pub one_cycle: bool,
}

impl Policy {
    pub fn verify(
        &self,
        chain_id: u64,
        signature: &str,
        dep: &Deployment,
        agent: [u8; 20],
    ) -> Result<(), String> {
        let trade = parse_hex::<20>(&self.trade_account)?;
        if dep.owner != parse_hex(&self.hedge_account)?
            || trade == dep.owner
            || trade == [0; 20]
            || self.environment != dep.environment
            || self.market != "SOL"
            || self.asset_id != dep.asset_id
            || self.price_source != "hyperliquid-mark"
            || agent != parse_hex(&self.guard_agent)?
            || !self.one_cycle
        {
            return Err("policy does not match provisioned owner, agent, or market".into());
        }
        if self.version == 0
            || self.watch_scope & 1 == 0
            || self.watch_scope & !15 != 0
            || self.cap_lots == 0
            || self.entry_floor_e8 == 0
            || self.entry_floor_e8 > self.entry_trigger_e8
            || self.entry_trigger_e8 >= self.recovery_trigger_e8
            || self.recovery_trigger_e8 > self.buyback_ceiling_e8
            || self.entry_window_ms == 0
            || self.expiry_ms == 0
            || chain_id == 0
            || parse_hex::<32>(&self.guard_build_hash)? == [0; 32]
        {
            return Err("invalid signed policy bounds".into());
        }
        if recover(&self.digest(chain_id)?, &parse_hex(signature)?)? != dep.owner {
            return Err("policy signature is not from the provisioned owner".into());
        }
        Ok(())
    }

    pub fn digest(&self, chain_id: u64) -> Result<[u8; 32], String> {
        let domain = hash_words(&[
            keccak("EIP712Domain(string name,string version,uint256 chainId)"),
            keccak("Baghedge"),
            keccak("1"),
            uint_word(chain_id),
        ]);
        let message = hash_words(&[
            keccak(POLICY_TYPE),
            keccak(self.environment.name()),
            parse_hex(&self.rule_id)?,
            uint_word(self.version.into()),
            uint_word(self.policy_nonce),
            address_word(parse_hex(&self.trade_account)?),
            address_word(parse_hex(&self.hedge_account)?),
            parse_hex(&self.watched_solana)?,
            uint_word(self.watch_scope.into()),
            keccak(&self.market),
            uint_word(self.asset_id.into()),
            keccak(&self.price_source),
            address_word(parse_hex(&self.guard_agent)?),
            parse_hex(&self.guard_build_hash)?,
            uint_word(self.cap_lots),
            uint_word(self.entry_trigger_e8),
            uint_word(self.entry_floor_e8),
            uint_word(self.recovery_trigger_e8),
            uint_word(self.buyback_ceiling_e8),
            uint_word(self.entry_window_ms),
            uint_word(self.expiry_ms),
            uint_word(self.min_margin_e6),
            uint_word(u64::from(self.one_cycle)),
        ]);
        Ok(typed_digest(domain, message))
    }
}

fn uint64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    use serde::de::Error;
    let value = String::deserialize(d)?;
    if !value.bytes().all(|b| b.is_ascii_digit()) || (value.starts_with('0') && value.len() > 1) {
        return Err(D::Error::custom(
            "uint64 must be a canonical decimal string",
        ));
    }
    value.parse().map_err(D::Error::custom)
}
