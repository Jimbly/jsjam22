/* eslint-disable import/order */
const assert = require('assert');
const request = require('request');
const NodeRSA = require('node-rsa');
const jwt = require('jsonwebtoken');
const { asyncLimiter } = require('glov-async');
const { serverConfig } = require('./server_config.js');

const APPLE_IDENTITY_URL = 'https://appleid.apple.com';
let ios_bundle_id;

let cached_keys = {};
let getkeys_limiter = asyncLimiter(1);

function getAppleIdentityPublicKey(client, kid, forceKeyFetch, callback) {
  getkeys_limiter((done) => {
    let pemKey = cached_keys[kid];
    if (pemKey) {
      if (forceKeyFetch) {
        delete cached_keys[kid];
      } else {
        return void callback(null, pemKey);
      }
    }

    const url = `${APPLE_IDENTITY_URL}/auth/keys`;
    request({ url, json: true, method: 'GET' }, (err, response, body) => {
      if (err || response.statusCode !== 200) {
        done();
        return void callback(err || `Error ${response.statusCode}`);
      }

      body.keys.forEach((key) => {
        const pubKey = new NodeRSA();
        pubKey.importKey({ n: Buffer.from(key.n, 'base64'), e: Buffer.from(key.e, 'base64') }, 'components-public');
        cached_keys[key.kid] = pubKey.exportKey(['public']);
      });
      done();

      pemKey = cached_keys[kid];
      if (pemKey) {
        callback(null, pemKey);
      } else {
        callback(`Key identifier '${kid}' not found`);
      }
    });
  });
}

function appleSignInValidateTokenInternal(client, identityToken, forceKeyFetch, callback) {
  assert(ios_bundle_id);
  const clientID = ios_bundle_id;
  const { header } = jwt.decode(identityToken, { complete: true });
  getAppleIdentityPublicKey(client, header.kid, forceKeyFetch, function (error, applePublicKey) {
    if (error) {
      return void callback(error);
    }

    let jwtClaims;
    try {
      jwtClaims = jwt.verify(identityToken, applePublicKey, { algorithms: 'RS256' });
    } catch (e) {
      if (!forceKeyFetch) {
        // If there was an error while verifying the token, allow the possibility that the
        // signing key value may have changed, so try again by forcefully fetching the key.
        return void appleSignInValidateTokenInternal(client, identityToken, true, callback);
      }
      return void callback(e);
    }
    assert(jwtClaims);

    if (jwtClaims.iss !== APPLE_IDENTITY_URL) {
      return void callback(`Apple identity token wrong issuer: ${jwtClaims.iss}`);
    }
    if (jwtClaims.aud !== clientID) {
      return void callback(`Apple identity token wrong audience: ${jwtClaims.aud}`);
    }
    let date = new Date();
    if (jwtClaims.exp < date.getTime()/1000) {
      return void callback('Apple identity token expired');
    }

    return void callback(null, jwtClaims);
  });
}

export function appleSignInValidateToken(client, identityToken, callback) {
  appleSignInValidateTokenInternal(client, identityToken, false, callback);
}

export function appleSignInInit() {
  ios_bundle_id = serverConfig().ios_bundle_id;
}
