'use client';

import { useCallback, useRef, useState } from 'react';

export interface EncryptionKeys {
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  sharedSecret?: CryptoKey;
  aesKey?: CryptoKey;
}

export interface EncryptedMessage {
  data: string; // base64 encoded encrypted data
  iv: string;   // base64 encoded initialization vector
}

export default function useEncryption() {
  const [isKeyGenerated, setIsKeyGenerated] = useState(false);
  const [isSharedKeyDerived, setIsSharedKeyDerived] = useState(false);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const keysRef = useRef<EncryptionKeys | null>(null);

  // Generate ephemeral ECDH key pair
  const generateKeyPair = useCallback(async (): Promise<JsonWebKey> => {
    try {
      console.log('[Encryption] Generating ECDH key pair...');
      
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256', // Use P-256 curve for good security/performance balance
        },
        false, // Not extractable for security
        ['deriveKey']
      );

      // Export public key to share with peer
      const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      
      keysRef.current = {
        keyPair,
        publicKeyJwk,
      };

      setIsKeyGenerated(true);
      console.log('[Encryption] Key pair generated successfully');
      console.log('[Encryption] Public key JWK:', publicKeyJwk);
      
      return publicKeyJwk;
    } catch (error) {
      console.error('[Encryption] Failed to generate key pair:', error);
      throw error;
    }
  }, []);

  // Derive shared secret and AES key from peer's public key
  const deriveSharedKey = useCallback(async (peerPublicKeyJwk: JsonWebKey): Promise<void> => {
    // Wait for local key pair to be generated if not ready
    if (!keysRef.current?.keyPair) {
      console.log('[Encryption] Waiting for local key pair generation...');
      // Wait up to 5 seconds for key generation
      const startTime = Date.now();
      while (!keysRef.current?.keyPair && (Date.now() - startTime) < 5000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (!keysRef.current?.keyPair) {
        throw new Error('Local key pair not generated within timeout');
      }
    }

    try {
      console.log('[Encryption] Deriving shared key with peer...');
      console.log('[Encryption] Peer public key:', peerPublicKeyJwk);

      // Import peer's public key
      const peerPublicKey = await crypto.subtle.importKey(
        'jwk',
        peerPublicKeyJwk,
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        false,
        []
      );

      // Derive shared secret
      const sharedSecret = await crypto.subtle.deriveKey(
        {
          name: 'ECDH',
          public: peerPublicKey,
        },
        keysRef.current.keyPair.privateKey,
        {
          name: 'AES-GCM',
          length: 256, // 256-bit AES key
        },
        false, // Not extractable
        ['encrypt', 'decrypt']
      );

      keysRef.current.sharedSecret = sharedSecret;
      keysRef.current.aesKey = sharedSecret; // Same key for AES-GCM

      setIsSharedKeyDerived(true);
      console.log('[Encryption] Shared AES-GCM key derived successfully');
    } catch (error) {
      console.error('[Encryption] Failed to derive shared key:', error);
      throw error;
    }
  }, []);

  // Encrypt message using AES-GCM
  const encryptMessage = useCallback(async (message: string): Promise<EncryptedMessage> => {
    if (!encryptionEnabled) {
      // Return message as-is if encryption is disabled
      return {
        data: btoa(message), // Still base64 encode for consistency
        iv: '',
      };
    }

    if (!keysRef.current?.aesKey) {
      throw new Error('AES key not available. Perform key exchange first.');
    }

    try {
      console.log('[Encryption] Encrypting message:', message.substring(0, 50) + '...');

      // Generate random IV for each message
      const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

      // Encrypt the message
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      
      const encryptedData = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        keysRef.current.aesKey,
        data
      );

      // Convert to base64 for transmission
      const encryptedMessage: EncryptedMessage = {
        data: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
        iv: btoa(String.fromCharCode(...iv)),
      };

      console.log('[Encryption] Message encrypted successfully');
      return encryptedMessage;
    } catch (error) {
      console.error('[Encryption] Failed to encrypt message:', error);
      throw error;
    }
  }, [encryptionEnabled]);

  // Decrypt message using AES-GCM
  const decryptMessage = useCallback(async (encryptedMessage: EncryptedMessage): Promise<string> => {
    if (!encryptionEnabled) {
      // Return decoded message if encryption is disabled
      return atob(encryptedMessage.data);
    }

    if (!keysRef.current?.aesKey) {
      throw new Error('AES key not available. Perform key exchange first.');
    }

    try {
      console.log('[Encryption] Decrypting message...');

      // Convert from base64
      const encryptedData = new Uint8Array(
        atob(encryptedMessage.data).split('').map(char => char.charCodeAt(0))
      );
      const iv = new Uint8Array(
        atob(encryptedMessage.iv).split('').map(char => char.charCodeAt(0))
      );

      // Decrypt the message
      const decryptedData = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        keysRef.current.aesKey,
        encryptedData
      );

      const decoder = new TextDecoder();
      const message = decoder.decode(decryptedData);

      console.log('[Encryption] Message decrypted successfully');
      return message;
    } catch (error) {
      console.error('[Encryption] Failed to decrypt message:', error);
      throw new Error('Failed to decrypt message. Possible tampering or wrong key.');
    }
  }, [encryptionEnabled]);

  // Reset encryption state (useful for new sessions)
  const resetEncryption = useCallback(() => {
    keysRef.current = null;
    setIsKeyGenerated(false);
    setIsSharedKeyDerived(false);
    console.log('[Encryption] Encryption state reset');
  }, []);

  // Get current public key (for sharing with peer)
  const getPublicKey = useCallback((): JsonWebKey | null => {
    return keysRef.current?.publicKeyJwk || null;
  }, []);

  return {
    // State
    isKeyGenerated,
    isSharedKeyDerived,
    encryptionEnabled,
    
    // Actions
    generateKeyPair,
    deriveSharedKey,
    encryptMessage,
    decryptMessage,
    resetEncryption,
    getPublicKey,
    setEncryptionEnabled,
    
    // Computed state
    isReady: isKeyGenerated && isSharedKeyDerived,
  };
}