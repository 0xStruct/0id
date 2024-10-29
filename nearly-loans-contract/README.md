# NEARLY Loans Contracts

Assets in any chains can be used as collaterals to get loans

- nearly-loans-broker.testnet => broker loan requests between borrowers and lenders
- nearly-loans-ckt-token.testnet => chain keys as NFT tokens
- nearly-loans-ckt-signer.testnet => signer

# Quickstart

1. Make sure you have installed [node.js](https://nodejs.org/en/download/package-manager/) >= 16.
2. Install the [`NEAR CLI`](https://github.com/near/near-cli#setup)

## 1. Build and Test the Contract
You can automatically compile and test the contract by running:

```bash
pnpm install
pnpm run build
pnpm run test
```

## 2. Create an Account and Deploy the Contract
You can create a new account and deploy the contract by running:

```bash
near create-account <your-account.testnet> --useFaucet
near deploy <your-account.testnet> build/release/broker.wasm
```