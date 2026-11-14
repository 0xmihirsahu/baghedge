mod crypto;
mod orders;
mod policy;

use crypto::{action_hash, address_from_key, agent_digest, recover};
use orders::{Action, CancelRef};
use policy::{Deployment, Environment, Policy};
use serde::Deserialize;
use serde_json::{json, Value};
use sha3::{Digest, Keccak256};
use std::io::{self, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

wit_bindgen::generate!({ world: "signing-probe", path: "wit" });
use outlayer::signing_keys::api;

#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static MANIFEST: [u8; include_bytes!("../manifest.json").len()] =
    *include_bytes!("../manifest.json");

const PATH: &str = "guard";
const PROBE_PREFIX: &str = "Baghedge OutLayer signing probe v1:";
const MAX_INPUT: u64 = 8192;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    PublicKey,
    SignChallenge {
        challenge: String,
    },
    SignOrder {
        policy: Box<Policy>,
        #[serde(rename = "ownerSig")]
        owner_sig: String,
        #[serde(rename = "chainId")]
        chain_id: u64,
        action: Action,
        nonce: u64,
        #[serde(rename = "expiresAfter")]
        expires_after: u64,
        #[serde(rename = "entryUntilMs")]
        entry_until: Option<u64>,
        #[serde(default, rename = "cancelRefs")]
        cancel_refs: Vec<CancelRef>,
    },
}

fn main() {
    let result = run().unwrap_or_else(|error| json!({ "ok": false, "error": error }));
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{result}").and_then(|()| stdout.flush());
}

fn run() -> Result<Value, String> {
    let mut input = String::new();
    io::stdin()
        .take(MAX_INPUT + 1)
        .read_to_string(&mut input)
        .map_err(|_| "Could not read probe input")?;
    if input.len() as u64 > MAX_INPUT {
        return Err("Guard input is too large".into());
    }
    let request: Request = serde_json::from_str(&input).map_err(|_| "Invalid guard request")?;
    let challenge = match &request {
        Request::PublicKey => None,
        Request::SignChallenge { challenge } => Some(challenge_digest(challenge)?),
        Request::SignOrder { .. } => None,
    };

    let public_key = api::public_key(PATH, None)?;
    let agent = address_from_key(&public_key)?;
    if let Request::SignOrder {
        policy,
        owner_sig,
        chain_id,
        action,
        nonce,
        expires_after,
        entry_until,
        cancel_refs,
    } = request
    {
        let deployment = Deployment::pinned()?;
        policy.verify(chain_id, &owner_sig, &deployment, agent)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "guard clock unavailable")?
            .as_millis() as u64;
        if nonce.abs_diff(now) > 60_000 || nonce > expires_after {
            return Err("invalid venue nonce".into());
        }
        action.validate(
            &deployment,
            &policy,
            now,
            expires_after,
            entry_until,
            &cancel_refs,
        )?;
        let connection_id = action_hash(&action, nonce, Some(expires_after))?;
        let digest = agent_digest(
            connection_id,
            deployment.environment == Environment::Mainnet,
        );
        let signature: [u8; 65] = api::sign(PATH, None, &digest)?
            .try_into()
            .map_err(|_| "invalid guard signature length")?;
        if signature[64] > 1 || recover(&digest, &signature)? != agent {
            return Err("host returned a signature for another agent".into());
        }
        return Ok(json!({
            "ok": true, "agent": format!("0x{}", hex::encode(agent)),
            "connectionId": format!("0x{}", hex::encode(connection_id)),
            "nonce": nonce, "expiresAfter": expires_after,
            "r": format!("0x{}", hex::encode(&signature[..32])),
            "s": format!("0x{}", hex::encode(&signature[32..64])),
            "v": signature[64] + 27,
        }));
    }
    let address = format!("0x{}", hex::encode(agent));
    if let Some(digest) = challenge {
        let signature = api::sign(PATH, None, &digest)?;
        if signature.len() != 65 {
            return Err("Unexpected secp256k1 signature length".into());
        }
        return Ok(json!({
            "address": address,
            "digest": format!("0x{}", hex::encode(digest)),
            "signature": format!("0x{}", hex::encode(signature))
        }));
    }
    Ok(json!({ "address": address, "publicKey": format!("0x{}", hex::encode(public_key)) }))
}

fn challenge_digest(challenge: &str) -> Result<[u8; 32], String> {
    let challenge =
        hex::decode(challenge).map_err(|_| "Challenge must be 32 bytes encoded as hex")?;
    if challenge.len() != 32 {
        return Err("Challenge must be 32 bytes encoded as hex".into());
    }
    let mut hasher = Keccak256::new();
    hasher.update(PROBE_PREFIX.as_bytes());
    hasher.update(challenge);
    Ok(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::parse_hex;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixtures {
        policy: SignedPolicy,
        peer_policy: PeerPolicy,
        cancel_refs: Vec<CancelRef>,
        vectors: Vec<Vector>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PeerPolicy {
        policy: Policy,
        policy_digest: String,
        chain_id: u64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SignedPolicy {
        policy: Policy,
        owner_sig: String,
        policy_digest: String,
        chain_id: u64,
        entry_until_ms: u64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vector {
        name: String,
        action: Action,
        nonce: u64,
        expires_after: Option<u64>,
        source: String,
        connection_id: String,
        agent_digest: String,
    }

    fn fixtures() -> Fixtures {
        serde_json::from_str(include_str!("../../fixtures/vectors/hl-actions.json")).unwrap()
    }

    fn deployment(signed: &SignedPolicy) -> Deployment {
        Deployment {
            owner: parse_hex(&signed.policy.hedge_account).unwrap(),
            environment: Environment::Mainnet,
            asset_id: 5,
            size_decimals: 2,
        }
    }

    #[test]
    fn venue_hashes_and_agent_digests_match_sdk() {
        for v in fixtures().vectors {
            let hash = action_hash(&v.action, v.nonce, v.expires_after).unwrap();
            assert_eq!(
                hash,
                parse_hex::<32>(&v.connection_id).unwrap(),
                "{}",
                v.name
            );
            assert_eq!(
                agent_digest(hash, v.source == "a"),
                parse_hex::<32>(&v.agent_digest).unwrap(),
                "{}",
                v.name
            );
        }
    }

    #[test]
    fn policy_requires_the_pinned_owner_and_exact_signed_fields() {
        let mut signed = fixtures().policy;
        let dep = deployment(&signed);
        let agent = parse_hex(&signed.policy.guard_agent).unwrap();
        assert_eq!(
            signed.policy.digest(signed.chain_id).unwrap(),
            parse_hex::<32>(&signed.policy_digest).unwrap()
        );
        signed
            .policy
            .verify(signed.chain_id, &signed.owner_sig, &dep, agent)
            .unwrap();
        let wrong_owner = Deployment {
            owner: [9; 20],
            ..dep
        };
        assert!(signed
            .policy
            .verify(signed.chain_id, &signed.owner_sig, &wrong_owner, agent)
            .is_err());
        signed.policy.cap_lots += 1;
        assert!(signed
            .policy
            .verify(signed.chain_id, &signed.owner_sig, &dep, agent)
            .is_err());
    }

    #[test]
    fn testnet_policy_digest_matches_workers_vector() {
        let v = fixtures().peer_policy;
        assert_eq!(
            v.policy.digest(v.chain_id).unwrap(),
            parse_hex::<32>(&v.policy_digest).unwrap()
        );
    }

    #[test]
    fn entry_requires_the_signed_bounds_and_cancel_requires_rule_ownership() {
        let f = fixtures();
        let dep = deployment(&f.policy);
        let entry = &f.vectors[2];
        let cancel = &f.vectors[3];
        let end = f.policy.entry_until_ms;
        let mut policy = f.policy.policy;
        entry
            .action
            .validate(
                &dep,
                &policy,
                entry.nonce,
                entry.expires_after.unwrap(),
                Some(end),
                &[],
            )
            .unwrap();
        cancel
            .action
            .validate(
                &dep,
                &policy,
                cancel.nonce,
                cancel.expires_after.unwrap(),
                None,
                &f.cancel_refs,
            )
            .unwrap();
        assert!(entry
            .action
            .validate(
                &dep,
                &policy,
                end,
                entry.expires_after.unwrap(),
                Some(end),
                &[]
            )
            .is_err());
        assert!(cancel
            .action
            .validate(
                &dep,
                &policy,
                cancel.nonce,
                cancel.expires_after.unwrap(),
                None,
                &[]
            )
            .is_err());
        policy.cap_lots -= 1;
        policy.version += 1;
        assert!(entry
            .action
            .validate(
                &dep,
                &policy,
                entry.nonce,
                entry.expires_after.unwrap(),
                Some(end),
                &[]
            )
            .is_err());
        assert!(cancel
            .action
            .validate(
                &dep,
                &policy,
                cancel.nonce,
                cancel.expires_after.unwrap(),
                None,
                &f.cancel_refs
            )
            .is_err());
    }

    #[test]
    fn challenge_never_passes_raw_bytes_through() {
        let challenge = [0x42; 32];
        let digest = challenge_digest(&hex::encode(challenge)).unwrap();
        assert_ne!(digest, challenge);
        assert!(challenge_digest("aabb").is_err());
        assert!(serde_json::from_str::<Request>(
            r#"{"operation":"sign_challenge","challenge":"abcd","digest":"0xdead"}"#
        )
        .is_err());
    }
}
