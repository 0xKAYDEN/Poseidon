-- Encrypt/decrypt sensitive payloads with AES-256-GCM and sign digests with HMAC-SHA512.

return {
  run = function(context)
    local keyB64 = crypto.random_bytes(32)
    local message = "Poseidon secret payload @ " .. flow.now()
    local ptB64 = encoding.base64_encode(message)

    local encrypted = crypto.aes_encrypt(ptB64, keyB64)
    local decryptedB64 = crypto.aes_decrypt(encrypted, keyB64)
    local roundTrip = encoding.base64_decode(decryptedB64)
    local hmac512 = crypto.hmac_sha512(message, "signing-key")

    flow.assert(roundTrip == message, "AES round-trip mismatch")
    flow.log("AES-256-GCM round-trip verified + HMAC-SHA512 generated")

    return {
      verified = true,
      ciphertext_b64 = encrypted,
      plaintext = roundTrip,
      sha512 = crypto.sha512(message),
      hmac_sha512 = string.sub(hmac512, 1, 32) .. "..."
    }
  end
}
