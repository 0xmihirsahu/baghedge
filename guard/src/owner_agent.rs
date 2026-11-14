use crate::outlayer::encryption_keys::api;
use crate::policy::Environment;
use k256::ecdsa::SigningKey;
use zeroize::Zeroizing;

const PATH: &str = "baghedge-owner-agent-v1";
const DOMAIN: &[u8] = b"Baghedge/Hyperliquid/Agent/v1";

pub fn require_direct_caller() -> Result<(), String> {
    check_caller(
        option_env!("BAGHEDGE_MULTI_OWNER_CALLER"),
        std::env::var("NEAR_SENDER_ID").ok().as_deref(),
        std::env::var("NEAR_PREDECESSOR_ID").ok().as_deref(),
    )
}

pub fn key(owner: [u8; 20], environment: Environment) -> Result<SigningKey, String> {
    derive(owner, environment, |data| api::mac(PATH, None, data))
}

pub fn sign(key: &SigningKey, digest: &[u8; 32]) -> Result<[u8; 65], String> {
    let (signature, recovery) = key
        .sign_prehash_recoverable(digest)
        .map_err(|_| "could not sign scoped venue action")?;
    let mut result = [0; 65];
    result[..64].copy_from_slice(&signature.to_bytes());
    result[64] = recovery.to_byte();
    Ok(result)
}

fn check_caller(
    pinned: Option<&str>,
    sender: Option<&str>,
    predecessor: Option<&str>,
) -> Result<(), String> {
    let Some(id) = pinned.filter(|id| !matches!(*id, "" | "baghedge.near")) else {
        return Err("multi-owner guard needs a dedicated NEAR caller".into());
    };
    if sender != Some(id) || predecessor != Some(id) {
        return Err("multi-owner guard requires its direct NEAR caller".into());
    }
    Ok(())
}

fn derive(
    owner: [u8; 20],
    environment: Environment,
    mut mac: impl FnMut(&[u8]) -> Result<Vec<u8>, String>,
) -> Result<SigningKey, String> {
    if owner == [0; 20] {
        return Err("invalid hedge owner".into());
    }
    let mut input = Vec::with_capacity(DOMAIN.len() + 22);
    input.extend_from_slice(DOMAIN);
    input.push(u8::from(environment == Environment::Mainnet));
    input.extend_from_slice(&owner);
    for counter in 0..8 {
        input.push(counter);
        let bytes = Zeroizing::new(mac(&input).map_err(|_| "owner agent key unavailable")?);
        input.pop();
        if bytes.len() != 32 {
            return Err("invalid owner agent key length".into());
        }
        if let Ok(key) = SigningKey::from_slice(bytes.as_slice()) {
            return Ok(key);
        }
    }
    Err("could not derive owner agent key".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{address_from_key, keccak, recover};

    #[test]
    fn agent_separates_owner_and_network_and_signs_as_its_public_address() {
        let mac = |input: &[u8]| Ok(keccak(input).to_vec());
        let derive_agent = |owner, env| {
            let key = derive(owner, env, mac).unwrap();
            let public = key.verifying_key().to_encoded_point(false);
            let address = address_from_key(&public.as_bytes()[1..]).unwrap();
            let digest = keccak("checked action");
            assert_eq!(
                recover(&digest, &sign(&key, &digest).unwrap()).unwrap(),
                address
            );
            address
        };
        let a = derive_agent([1; 20], Environment::Mainnet);
        assert_eq!(a, derive_agent([1; 20], Environment::Mainnet));
        assert_ne!(a, derive_agent([2; 20], Environment::Mainnet));
        assert_ne!(a, derive_agent([1; 20], Environment::Testnet));
    }

    #[test]
    fn scalar_rejection_uses_a_bounded_counter() {
        let mut tries = 0u8;
        assert!(derive([1; 20], Environment::Mainnet, |data| {
            assert_eq!(data.last(), Some(&tries));
            tries += 1;
            Ok(vec![0; 32])
        })
        .is_err());
        assert_eq!(tries, 8);
        assert!(derive([1; 20], Environment::Mainnet, |data| {
            Ok(vec![*data.last().unwrap(); 32])
        })
        .is_ok());
        assert!(derive([0; 20], Environment::Mainnet, |_| panic!(
            "invalid owner must not derive"
        ))
        .is_err());
    }

    #[test]
    fn only_the_pinned_direct_executor_may_use_the_key() {
        let id = Some("executor.example.near");
        assert!(check_caller(id, id, id).is_ok());
        assert!(check_caller(id, id, None).is_err());
        assert!(check_caller(id, id, Some("proxy.near")).is_err());
        assert!(check_caller(id, Some("someone.near"), id).is_err());
        let wallet = Some("baghedge.near");
        assert!(check_caller(wallet, wallet, wallet).is_err());
    }
}
