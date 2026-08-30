#!/usr/bin/env node
// scripts/b402-keygen.js — generate Binance B402 RSA keypair (1024-bit).
// Run on YOUR machine only. Never in CI. Never paste private key into Render logs.
//
// Usage: node scripts/b402-keygen.js
//
// Submit the PUBLIC key (SPKI Base64 DER) on the Binance partner form.
// Store the PRIVATE key (PKCS#8 Base64 DER) as Render env B402_RSA_PRIVATE_KEY.

'use strict';

const { generateKeyPairSync } = require('crypto');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});

const pubB64 = publicKey.toString('base64');
const privB64 = privateKey.toString('base64');

process.stdout.write(
  [
    '=== B402 RSA keypair (1024-bit) ===',
    '',
    'PUBLIC KEY — Base64 DER (SPKI) — submit to Binance partner form:',
    pubB64,
    '',
    'PRIVATE KEY — Base64 DER (PKCS#8) — set as Render env B402_RSA_PRIVATE_KEY:',
    privB64,
    '',
    'Keep the private key secret. Do not commit it. Do not print it in deploy logs.',
    ''
  ].join('\n')
);
