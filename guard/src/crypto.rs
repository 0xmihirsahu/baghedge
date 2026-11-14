use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use serde::Serialize;
use sha3::{Digest, Keccak256};

pub fn keccak(bytes: impl AsRef<[u8]>) -> [u8; 32] {
    Keccak256::digest(bytes.as_ref()).into()
}

pub fn parse_hex<const N: usize>(value: &str) -> Result<[u8; N], String> {
    let mut bytes = [0; N];
    let raw = value.strip_prefix("0x").ok_or("expected hex prefix")?;
    hex::decode_to_slice(raw, &mut bytes).map_err(|_| "invalid hex length or digits")?;
    Ok(bytes)
}

pub fn address_word(address: [u8; 20]) -> [u8; 32] {
    let mut word = [0; 32];
    word[12..].copy_from_slice(&address);
    word
}

pub fn uint_word(value: u64) -> [u8; 32] {
    let mut word = [0; 32];
    word[24..].copy_from_slice(&value.to_be_bytes());
    word
}

pub fn hash_words(words: &[[u8; 32]]) -> [u8; 32] {
    let mut hash = Keccak256::new();
    for word in words {
        hash.update(word);
    }
    hash.finalize().into()
}

pub fn typed_digest(domain: [u8; 32], message: [u8; 32]) -> [u8; 32] {
    let mut hash = Keccak256::new();
    hash.update([0x19, 0x01]);
    hash.update(domain);
    hash.update(message);
    hash.finalize().into()
}

pub fn address_from_key(key: &[u8]) -> Result<[u8; 20], String> {
    if key.len() != 64 {
        return Err("invalid secp256k1 public key length".into());
    }
    Ok(keccak(key)[12..].try_into().expect("20 address bytes"))
}

pub fn recover(digest: &[u8; 32], signature: &[u8; 65]) -> Result<[u8; 20], String> {
    let recovery = match signature[64] {
        0 | 1 => signature[64],
        27 | 28 => signature[64] - 27,
        _ => return Err("invalid EVM recovery ID".into()),
    };
    let id = RecoveryId::from_byte(recovery).ok_or("invalid recovery ID")?;
    let signature =
        Signature::from_slice(&signature[..64]).map_err(|_| "invalid ECDSA signature")?;
    if signature.normalize_s().is_some() {
        return Err("non-canonical ECDSA signature".into());
    }
    let key = VerifyingKey::recover_from_prehash(digest, &signature, id)
        .map_err(|_| "could not recover signer")?;
    address_from_key(&key.to_encoded_point(false).as_bytes()[1..])
}

pub fn action_hash(
    action: &impl Serialize,
    nonce: u64,
    expires_after: Option<u64>,
) -> Result<[u8; 32], String> {
    let mut bytes = rmp_serde::to_vec_named(action).map_err(|_| "could not encode L1 action")?;
    bytes.extend_from_slice(&nonce.to_be_bytes());
    bytes.push(0); // Master accounts omit vaultAddress.
    if let Some(expiry) = expires_after {
        bytes.push(0);
        bytes.extend_from_slice(&expiry.to_be_bytes());
    }
    Ok(keccak(bytes))
}

pub fn agent_digest(connection_id: [u8; 32], mainnet: bool) -> [u8; 32] {
    let domain = hash_words(&[
        keccak(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
        ),
        keccak("Exchange"),
        keccak("1"),
        uint_word(1337),
        [0; 32],
    ]);
    let message = hash_words(&[
        keccak("Agent(string source,bytes32 connectionId)"),
        keccak(if mainnet { "a" } else { "b" }),
        connection_id,
    ]);
    typed_digest(domain, message)
}
