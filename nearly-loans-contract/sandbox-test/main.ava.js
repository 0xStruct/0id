import anyTest from 'ava';
import { NEAR, Worker } from 'near-workspaces';
import { setDefaultResultOrder } from 'dns'; setDefaultResultOrder('ipv4first'); // temp fix for node >v17

/**
 *  @typedef {import('near-workspaces').NearAccount} NearAccount
 *  @type {import('ava').TestFn<{worker: Worker, accounts: Record<string, NearAccount>}>}
 */
const test = anyTest;
const NFT_WASM_FILEPATH = "./sandbox-test/nft_key/nft_key.wasm";
const SIGNER_WASM_FILEPATH = "./sandbox-test/signer/signer.wasm";

test.beforeEach(async t => {
  // Create sandbox
  const worker = t.context.worker = await Worker.init();

  // Deploy contract
  const root = worker.rootAccount;
  const contract = await root.createSubAccount('test-account');

  // Get wasm file path from package.json test script in folder above
  await contract.deploy(
    process.argv[2],
  );

  const borrower = await root.createSubAccount("borrower", { initialBalance: NEAR.parse("10 N").toString() });
  const lender = await root.createSubAccount("lender", { initialBalance: NEAR.parse("10 N").toString() });

  const nft_contract = await root.devDeploy(NFT_WASM_FILEPATH);
  const signer_contract = await root.devDeploy(SIGNER_WASM_FILEPATH);

  // await nft_contract.call(nft_contract, "new_default_meta", { "owner_id": nft_contract.accountId });
  await nft_contract.call(nft_contract, "new", { "signer_contract_id": signer_contract.accountId });

  // Mint NFT to borrower to be used as collateral
  const TOKEN_ID = "1";
  let request_payload = {
    "token_id": TOKEN_ID,
    "receiver_id": borrower.accountId,
    "metadata": {
      "title": "CKT - Chain Keys Token",
      "description": "Chain Abstractions is awesome!",
      "media": "https://cdn-icons-png.flaticon.com/512/2165/2165574.png"
    },
  };

  // await nft_contract.call(nft_contract, "nft_mint", request_payload, { attachedDeposit: NEAR.from("8000000000000000000000").toString(), gas: "300000000000000" });

  // Save state for test runs, it is unique for each test
  t.context.accounts = { root, contract, nft_contract, borrower, lender };
});

test.afterEach.always(async (t) => {
  await t.context.worker.tearDown().catch((error) => {
    console.log('Failed to stop the Sandbox:', error);
  });
});

test("Test loan process between borrower and lender (request, offer, redeem, etc)", async (t) => {
  const { borrower, lender, contract, nft_contract } = t.context.accounts;

  let request_payload, response;

  // deposits for storage
  await contract.call(nft_contract, "storage_deposit", {}, { attachedDeposit: NEAR.parse("1 N").toString(), gas: "300000000000000" });
  await borrower.call(nft_contract, "storage_deposit", {}, { attachedDeposit: NEAR.parse("1 N").toString(), gas: "300000000000000" });
  await lender.call(nft_contract, "storage_deposit", {}, { attachedDeposit: NEAR.parse("1 N").toString(), gas: "300000000000000" });

  // borrower mints ckt
  let token_id = await borrower.call(nft_contract, "mint", {}, { gas: "300000000000000" });
  t.log("token_id", token_id);

  // check that ckt has been minted to borrower
  response = await borrower.call(nft_contract, "nft_token", { "token_id": "0" }, { });
  t.is(response.owner_id, borrower.accountId);

  // send NFT to the contract (nft_transfer but do nft_transfer_call instead)
  // request_payload = { "receiver_id": contract.accountId, "token_id": "0", "msg": "" };
  // await borrower.call(nft_contract, "nft_transfer", request_payload, { attachedDeposit: NEAR.from("1").toString(), gas: "300000000000000" });

  // borrower sends NFT to the contract, creating a loan request (draft)
  await borrower.call(nft_contract, "nft_transfer_call", { "receiver_id": contract.accountId, "token_id": "0", "memo": "test", "msg": "" }, { attachedDeposit: NEAR.from("1").toString(), gas: "300000000000000" });
  response = await nft_contract.call(nft_contract, "nft_token", { "token_id": "0" }, { gas: "300000000000000" });
  t.is(response.owner_id, contract.accountId);

  // Borrower edit the loan_request (DRAFT to REQUESTED)
  request_payload = { "loan_id": "0", "loan_duration": 10, "loan_interest_rate": 0.25, "loan_amount": "2000000000000000000000000" };
  await borrower.call(contract, "edit_request_loan", request_payload, { gas: "300000000000000" });

  // Check the owner of the NFT
  response = await nft_contract.call(nft_contract, "nft_token", { "token_id": "0" }, { gas: "300000000000000" });
  t.is(response.owner_id, contract.accountId);

  // get loans
  let loans = await contract.view("get_loans", {});
  t.log("get_loans", loans);

  // offer loan
  request_payload = { "loan_id": "0" };

  // offer 1N, should not work
  await t.throwsAsync(lender.call(contract, "offer_loan", request_payload, { attachedDeposit: NEAR.parse("1 N").toString(), gas: "300000000000000" }));

  // offer 2N, shoud work
  response = await lender.call(contract, "offer_loan", request_payload, { attachedDeposit: NEAR.parse("2 N").toString(), gas: "300000000000000" });
  t.is(response.loan_status, "OFFERED");
  t.log(response);

  // borrower starts loan and receives $NEAR
  const borrowerBalance = await borrower.balance();

  request_payload = { "loan_id": "0" };

  // non borrower should not be able to start the loan
  await t.throwsAsync(lender.call(contract, "start_loan", request_payload, { gas: "300000000000000" }));

  // only borrower should be able to start the loan
  await borrower.call(contract, "start_loan", request_payload, {});

  const borrowerNewBalance = await borrower.balance();
  t.log(["differences", borrowerNewBalance.available.toString(), borrowerBalance.available.add(NEAR.parse("2 N")).toString()]);
  // t.deepEqual(borrowerNewBalance.available, borrowerBalance.available.add(NEAR.parse("2 N"))));
  // slight difference due to gas fees

  // Fast forward 200 blocks
  await t.context.worker.provider.fastForward(200);

  // redeem loan
  request_payload = { "loan_id": "0" };

  // get loan
  let loan = await contract.view("get_loan", request_payload);

  // redeem properly
  const interest = Number(loan.loan_amount) * (loan.loan_interest_rate * loan.loan_duration / 365);
  const payback = BigInt(loan.loan_amount) + BigInt(interest);
  await borrower.call(contract, "redeem_loan", request_payload, { attachedDeposit: payback.toString(), gas: "300000000000000" });

  // check that borrower has gotten back the collateral after redeem process
  response = await nft_contract.call(nft_contract, "nft_token", { "token_id": "0" }, { gas: "300000000000000" });
  t.is(response.owner_id, borrower.accountId);

  loan = await contract.view("get_loan", request_payload);
  t.log(loan);

  // try redeeming again
  await t.throwsAsync(borrower.call(contract, "redeem_loan", request_payload, { attachedDeposit: payback.toString(), gas: "300000000000000" }));


  /*
  // liquidate loan
  await lender.call(contract, "liquidate_loan", request_payload, { gas: "300000000000000" });

  // check that lender has gotten the collateral after liquidate process
  response = await nft_contract.call(nft_contract, "nft_token", { "token_id": "0" }, { gas: "300000000000000" });
  t.is(response.owner_id, lender.accountId);

  loan = await contract.view("get_loan", request_payload);
  t.log(loan);
  */

});