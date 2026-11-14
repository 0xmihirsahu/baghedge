use serde::Deserialize;
use serde_json::{json, Value};
use sha3::{Digest, Keccak256};
use std::io::{self, Read};

wit_bindgen::generate!({ world: "signing-probe", path: "wit" });
use outlayer::signing_keys::api;

#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static MANIFEST: [u8; include_bytes!("../manifest.json").len()] =
    *include_bytes!("../manifest.json");

const PATH: &str = "guard";
const PROBE_PREFIX: &str = "Baghedge OutLayer signing probe v1:";

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    PublicKey,
    SignChallenge { challenge: String },
}

fn main() {
    let result = run().unwrap_or_else(|error| json!({ "error": error }));
    println!("{result}");
}

fn run() -> Result<Value, String> {
    let mut input = String::new();
    io::stdin()
        .take(1025)
        .read_to_string(&mut input)
        .map_err(|_| "Could not read probe input")?;
    if input.len() > 1024 {
        return Err("Probe input is too large".into());
    }
    let request: Request = serde_json::from_str(&input).map_err(|_| "Invalid probe request")?;
    let challenge = match request {
        Request::PublicKey => None,
        Request::SignChallenge { challenge } => Some(challenge_digest(&challenge)?),
    };

    let public_key = api::public_key(PATH, None)?;
    if public_key.len() != 64 {
        return Err("Unexpected secp256k1 public key length".into());
    }
    let address_hash = Keccak256::digest(&public_key);
    let address = format!("0x{}", hex::encode(&address_hash[12..]));
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
