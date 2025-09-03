const crypto = require('crypto');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.tagLength = 16; // 128 bits
  }

  /**
   * Decrypt data using a DEK
   */
  decryptWithDEK(encryptedData, dek, iv, tag) {
    const decipher = crypto.createDecipher(this.algorithm, dek);
    decipher.setAAD(Buffer.from('graker-dek-encryption', 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Unwrap a DEK using a master key
   */
  unwrapDEK(wrappedData, masterKey, iv, tag) {
    const keyHash = crypto.createHash('sha256').update(masterKey).digest();
    const decipher = crypto.createDecipher(this.algorithm, keyHash);
    decipher.setAAD(Buffer.from('graker-dek-wrapping', 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    
    let dek = decipher.update(wrappedData, 'hex', null);
    dek = Buffer.concat([dek, decipher.final()]);
    
    return dek;
  }

  /**
   * Decrypt sensitive data using scheduler key
   */
  decryptWithSchedulerKey(encryptedData, iv, tag, schedulerWrappedDEK, schedulerWrappedIV, schedulerWrappedTag, schedulerKey) {
    const dek = this.unwrapDEK(schedulerWrappedDEK, schedulerKey, schedulerWrappedIV, schedulerWrappedTag);
    return this.decryptWithDEK(encryptedData, dek, iv, tag);
  }
}

module.exports = new EncryptionService();
