# Aioha

Aioha is an API that provides a common interface for working with different Hive login providers. This allows easier integration of Hive login and transacting on the network with fewer code.

This repository contains the core API designed for use in browser contexts. Ready to use packages with UI included are to follow soon.

## Supported Providers

* [Keychain](https://hive-keychain.com)
* [HiveAuth](https://hiveauth.com)
* [HiveSigner](https://hivesigner.com)
* [Ledger](https://hiveledger.io)

## Installation

```sh
pnpm i @aioha/aioha
```

## Usage Example

```js
import { Aioha } from '@aioha/aioha'

// Instantiation
const aioha = new Aioha()

// Register providers
aioha.registerKeychain()
aioha.registerHiveSigner({
  app: 'ipfsuploader.app',
  callbackURL: window.location.origin + '/hivesigner.html',
  scope: ['login', 'vote']
})
aioha.registerHiveAuth({
  name: 'Aioha',
  description: 'Aioha test app'
})
aioha.registerLedger()

// Load persistent login from local storage
// returns boolean of whether a login has been loaded
const authLoaded = aioha.loadAuth()

// Get registered providers
console.log(aioha.getProviders())

// Get current logged in user and provider name
if (authLoaded) {
  console.log(aioha.getCurrentUser(), aioha.getCurrentProvider())
}

// Login with provider
// Supported providers are listed above, names converted to lowercase
const login = await aioha.login('keychain', 'hiveusername', {
  msg: 'Hello World',
  keyType: 'posting',
  hiveauth: {
    cbWait: (payload, evt) => {
      // display HiveAuth QR code using `payload` as data
    }
  }
})

// Transfer 1 HIVE using logged in provider
const xfer = await aioha.transfer('recipient', 1, 'HIVE', 'Transferred using Aioha with memo')

// Vote comment with 100% weight
const vote = await aioha.vote('author', 'permlink', 10000)

// Claim rewards
const rewardClaim = await aioha.claimRewards()
```

More usage details can be found on the Aioha documentation (TBD).

## Local storage reserved keys

Aioha uses certain keys in browser `localStorage` to store persistent logins, and in the case of HiveSigner provider, pass info from callback URL.

The following keys are reserved:

* General: `aiohaUsername`, `aiohaProvider`
* HiveAuth: `hiveauthToken`, `hiveauthKey`, `hiveauthExp`
* HiveSigner: `hivesignerTxId`, `hivesignerToken`, `hivesignerExpiry`, `hivesignerUsername`
* Ledger: `ledgerPath`

## HiveSigner callback page

A callback page is required for HiveSigner provider. An example HTML with the code which parses the response data and stores them into `localStorage` has been included in `snippets/hivesigner.html` file.