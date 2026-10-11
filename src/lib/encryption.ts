import { supabase } from './supabase';

/**
 * Encryption key for PGP symmetric encryption
 * Should be set in environment variables as ENCRYPTION_KEY
 */
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

if (!ENCRYPTION_KEY && process.env.NODE_ENV !== 'test') {
  console.warn('ENCRYPTION_KEY is not set. Encrypted fields will not be properly encrypted/decrypted.');
}

/**
 * Encrypt text using PGP symmetric encryption via Supabase
 */
export async function encryptText(text: string): Promise<string | null> {
  if (!text) return null;

  try {
    const { data, error } = await supabase
      .rpc('pgp_sym_encrypt', {
        plaintext: text,
        key: ENCRYPTION_KEY
      });

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error('Error encrypting text:', error);
    return null;
  }
}

/**
 * Decrypt text using PGP symmetric encryption via Supabase
 */
export async function decryptText(encrypted: string | null): Promise<string | null> {
  if (!encrypted) return null;

  try {
    const { data, error } = await supabase
      .rpc('pgp_sym_decrypt', {
        ciphertext: encrypted,
        key: ENCRYPTION_KEY
      });

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error('Error decrypting text:', error);
    return null;
  }
}

/**
 * Encrypt JSON object (will be stringified first)
 */
export async function encryptJSON(obj: any): Promise<string | null> {
  if (!obj) return null;
  try {
    const jsonString = JSON.stringify(obj);
    return await encryptText(jsonString);
  } catch (error) {
    console.error('Error encrypting JSON:', error);
    return null;
  }
}

/**
 * Decrypt string to JSON object
 */
export async function decryptJSON(encrypted: string | null): Promise<any | null> {
  if (!encrypted) return null;
  try {
    const jsonString = await decryptText(encrypted);
    if (!jsonString) return null;
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error decrypting JSON:', error);
    return null;
  }
}

/**
 * Encrypt array of strings (each element encrypted separately)
 * Returns array of encrypted strings
 */
export async function encryptStringArray(arr: string[]): Promise<string[] | null> {
  if (!arr || arr.length === 0) return null;

  try {
    const encryptedPromises = arr.map(item => encryptText(item.trim()));
    const encryptedResults = await Promise.all(encryptedPromises);
    // Filter out null results but preserve array structure
    const filtered = encryptedResults.filter((result): result is string => result !== null);
    return filtered.length > 0 ? filtered : null;
  } catch (error) {
    console.error('Error encrypting string array:', error);
    return null;
  }
}

/**
 * Decrypt array of encrypted strings to string array
 */
export async function decryptStringArray(encryptedArr: string[] | null): Promise<string[]> {
  if (!encryptedArr || encryptedArr.length === 0) return [];

  try {
    const decryptedPromises = encryptedArr.map(encrypted => decryptText(encrypted));
    const decryptedResults = await Promise.all(decryptedPromises);
    // Filter out null results
    return decryptedResults.filter((result): result is string => result !== null);
  } catch (error) {
    console.error('Error decrypting string array:', error);
    return [];
  }
}
