use crate::crypto::{keccak, parse_hex};
use crate::policy::{Deployment, Policy};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Action {
    #[serde(rename = "order")]
    Order {
        orders: Vec<Order>,
        grouping: Grouping,
    },
    #[serde(rename = "cancelByCloid")]
    CancelByCloid { cancels: Vec<Cancel> },
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Cancel {
    asset: u32,
    cloid: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CancelRef {
    intent: Intent,
    seq: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Intent {
    Entry,
    Stop,
    Resize,
    Close,
    PositionStop,
}

impl Intent {
    fn bytes(&self) -> &'static [u8] {
        match self {
            Self::Entry => b"entry",
            Self::Stop => b"stop",
            Self::Resize => b"resize",
            Self::Close => b"close",
            Self::PositionStop => b"position_stop",
        }
    }
}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
pub enum Grouping {
    #[serde(rename = "na")]
    Single,
    #[serde(rename = "normalTpsl")]
    Attached,
    #[serde(rename = "positionTpsl")]
    Position,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Order {
    a: u32,
    b: bool,
    p: String,
    s: String,
    r: bool,
    t: OrderType,
    #[serde(skip_serializing_if = "Option::is_none")]
    c: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase", deny_unknown_fields)]
enum OrderType {
    Limit(Limit),
    Trigger(Trigger),
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Limit {
    tif: Ioc,
}

#[derive(Deserialize, Serialize)]
enum Ioc {
    Ioc,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Trigger {
    is_market: bool,
    trigger_px: String,
    tpsl: StopLoss,
}

#[derive(Deserialize, Serialize)]
enum StopLoss {
    #[serde(rename = "sl")]
    StopLoss,
}

impl Action {
    pub fn validate(
        &self,
        deployment: &Deployment,
        policy: &Policy,
        now: u64,
        expires: u64,
        entry_until: Option<u64>,
        cancel_refs: &[CancelRef],
    ) -> Result<(), String> {
        if expires <= now || expires - now > 60_000 {
            return Err("invalid venue expiry".into());
        }
        let (orders, grouping) = match self {
            Self::CancelByCloid { cancels } if entry_until.is_none() => {
                return validate_cancels(cancels, cancel_refs, deployment, policy);
            }
            Self::Order { orders, grouping } if cancel_refs.is_empty() => (orders, grouping),
            _ => return Err("invalid action context".into()),
        };
        if orders.iter().any(|order| order.a != deployment.asset_id) {
            return Err("wrong order asset".into());
        }
        match (grouping, orders.as_slice()) {
            (Grouping::Attached, [entry, stop]) => {
                let until = entry_until.ok_or("entry deadline required")?;
                if until <= now
                    || expires > until
                    || until > policy.expiry_ms
                    || until - now > policy.entry_window_ms
                {
                    return Err("opening window expired or invalid".into());
                }
                if entry.b
                    || entry.r
                    || !matches!(entry.t, OrderType::Limit(_))
                    || entry.price(deployment)? < policy.entry_floor_e8
                    || entry.price(deployment)? > policy.entry_trigger_e8
                {
                    return Err("expected bounded entry sell IOC".into());
                }
                let size = entry.size(deployment, policy)?;
                if stop.validate_stop(deployment, policy)? != size
                    || stop.cloid()? == entry.cloid()?
                {
                    return Err("recovery stop does not cover entry".into());
                }
            }
            (Grouping::Single, [buy]) if buy.b && buy.r && matches!(buy.t, OrderType::Limit(_)) => {
                buy.validate_buy(deployment, policy)?;
            }
            (Grouping::Position, [stop]) => {
                stop.validate_stop(deployment, policy)?;
            }
            _ => return Err("unsupported order action".into()),
        }
        Ok(())
    }
}

fn validate_cancels(
    cancels: &[Cancel],
    refs: &[CancelRef],
    deployment: &Deployment,
    policy: &Policy,
) -> Result<(), String> {
    if cancels.is_empty() || cancels.len() != refs.len() || cancels.len() > 8 {
        return Err("invalid cancellation count".into());
    }
    let rule_id = parse_hex::<32>(&policy.rule_id)?;
    for (cancel, reference) in cancels.iter().zip(refs) {
        let mut input = rule_id.to_vec();
        input.extend_from_slice(&policy.version.to_be_bytes());
        input.extend_from_slice(reference.intent.bytes());
        input.extend_from_slice(&reference.seq.to_be_bytes());
        let hash = keccak(input);
        if cancel.asset != deployment.asset_id
            || cancel.cloid != format!("0x{}", hex::encode(&hash[..16]))
        {
            return Err("cancellation does not belong to the signed rule".into());
        }
    }
    Ok(())
}

impl Order {
    fn cloid(&self) -> Result<[u8; 16], String> {
        parse_hex(self.c.as_deref().ok_or("cloid required")?)
    }

    fn price(&self, deployment: &Deployment) -> Result<u64, String> {
        price_e8(&self.p, deployment.size_decimals)
    }

    fn size(&self, deployment: &Deployment, policy: &Policy) -> Result<u64, String> {
        let lots = units(&self.s, deployment.size_decimals)?;
        if lots == 0 || lots > policy.cap_lots {
            return Err("size outside signed cap".into());
        }
        Ok(lots)
    }

    fn validate_buy(&self, deployment: &Deployment, policy: &Policy) -> Result<u64, String> {
        self.cloid()?;
        if !self.b || !self.r || self.price(deployment)? > policy.buyback_ceiling_e8 {
            return Err("expected bounded reduce-only buy".into());
        }
        self.size(deployment, policy)
    }

    fn validate_stop(&self, deployment: &Deployment, policy: &Policy) -> Result<u64, String> {
        let OrderType::Trigger(trigger) = &self.t else {
            return Err("expected recovery trigger".into());
        };
        if trigger.is_market
            || price_e8(&trigger.trigger_px, deployment.size_decimals)?
                != policy.recovery_trigger_e8
            || self.price(deployment)? < policy.recovery_trigger_e8
        {
            return Err("invalid recovery trigger or limit".into());
        }
        self.validate_buy(deployment, policy)
    }
}

fn price_e8(value: &str, size_decimals: u8) -> Result<u64, String> {
    if let Some((whole, fraction)) = value.split_once('.') {
        let leading = whole
            .bytes()
            .chain(fraction.bytes())
            .take_while(|b| *b == b'0')
            .count();
        if fraction.len() > usize::from(6 - size_decimals)
            || whole.len() + fraction.len() - leading > 5
        {
            return Err("invalid price tick precision".into());
        }
    }
    let value = units(value, 8)?;
    if value == 0 {
        return Err("price must be positive".into());
    }
    Ok(value)
}

fn units(value: &str, decimals: u8) -> Result<u64, String> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || (whole.starts_with('0') && whole.len() > 1)
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || (value.contains('.') && (fraction.is_empty() || fraction.ends_with('0')))
        || fraction.len() > decimals.into()
    {
        return Err("non-canonical decimal".into());
    }
    let scale = 10u64.pow(decimals.into());
    let scaled = whole
        .parse::<u64>()
        .ok()
        .and_then(|n| n.checked_mul(scale))
        .ok_or("decimal overflow")?;
    let fraction_units = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<u64>()
            .map_err(|_| "invalid decimal fraction")?
            * 10u64.pow(u32::from(decimals) - fraction.len() as u32)
    };
    scaled
        .checked_add(fraction_units)
        .ok_or_else(|| "decimal overflow".into())
}
