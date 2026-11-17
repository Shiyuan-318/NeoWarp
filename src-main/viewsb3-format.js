const nodeCrypto = require('crypto');

const VSB3_V1_MAGIC = Buffer.from('VSB3\x01');
const VSB3_V2_MAGIC = Buffer.from('VSB3\x02');
const VSB3_SALT_LENGTH = 16;
const VSB3_IV_LENGTH = 12;
const VSB3_AUTH_TAG_LENGTH = 16;

// Passwordless viewing requires an application-wide secret. This protects the
// file container, but cannot prevent a determined recipient from reverse engineering it.
const VSB3_PASSWORD = 'neowarp-viewsb3-viewonly-v1';
const VSB3_V1_SALT = Buffer.from('NeoWarpViewSb3FixedSalt2024', 'utf8');
const VSB3_V1_PBKDF2_ITERATIONS = 10000;
const VSB3_V2_PBKDF2_ITERATIONS = 310000;

const deriveKey = (salt, iterations) => nodeCrypto.pbkdf2Sync(
  VSB3_PASSWORD,
  salt,
  iterations,
  32,
  'sha256'
);

const hasViewSb3Magic = (data) => Buffer.isBuffer(data) && data.length >= 5 && (
  data.slice(0, 5).equals(VSB3_V1_MAGIC) || data.slice(0, 5).equals(VSB3_V2_MAGIC)
);

const encryptViewSb3 = (data) => {
  const salt = nodeCrypto.randomBytes(VSB3_SALT_LENGTH);
  const iv = nodeCrypto.randomBytes(VSB3_IV_LENGTH);
  const key = deriveKey(salt, VSB3_V2_PBKDF2_ITERATIONS);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

  return Buffer.concat([VSB3_V2_MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
};

const decryptViewSb3V1 = (data) => {
  const ivStart = VSB3_V1_MAGIC.length;
  const authTagStart = ivStart + VSB3_IV_LENGTH;
  const encryptedStart = authTagStart + VSB3_AUTH_TAG_LENGTH;
  if (data.length < encryptedStart) {
    throw new Error('Not a valid .viewsb3 file');
  }

  const key = deriveKey(VSB3_V1_SALT, VSB3_V1_PBKDF2_ITERATIONS);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, data.slice(ivStart, authTagStart));
  decipher.setAuthTag(data.slice(authTagStart, encryptedStart));
  return Buffer.concat([decipher.update(data.slice(encryptedStart)), decipher.final()]);
};

const decryptViewSb3V2 = (data) => {
  const saltStart = VSB3_V2_MAGIC.length;
  const ivStart = saltStart + VSB3_SALT_LENGTH;
  const authTagStart = ivStart + VSB3_IV_LENGTH;
  const encryptedStart = authTagStart + VSB3_AUTH_TAG_LENGTH;
  if (data.length < encryptedStart) {
    throw new Error('Not a valid .viewsb3 file');
  }

  const salt = data.slice(saltStart, ivStart);
  const key = deriveKey(salt, VSB3_V2_PBKDF2_ITERATIONS);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, data.slice(ivStart, authTagStart));
  decipher.setAuthTag(data.slice(authTagStart, encryptedStart));
  return Buffer.concat([decipher.update(data.slice(encryptedStart)), decipher.final()]);
};

const decryptViewSb3 = (data) => {
  if (!hasViewSb3Magic(data)) {
    throw new Error('Not a valid .viewsb3 file');
  }

  try {
    if (data.slice(0, 5).equals(VSB3_V1_MAGIC)) {
      return decryptViewSb3V1(data);
    }
    return decryptViewSb3V2(data);
  } catch (error) {
    if (error.message === 'Not a valid .viewsb3 file') {
      throw error;
    }
    throw new Error('Corrupted .viewsb3 file');
  }
};

module.exports = {
  decryptViewSb3,
  encryptViewSb3,
  hasViewSb3Magic
};
