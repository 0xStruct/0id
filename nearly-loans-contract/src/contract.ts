// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, assert, NearPromise, PromiseIndex, view, AccountId, LookupMap, UnorderedMap, UnorderedSet, ONE_NEAR } from 'near-sdk-js';

class Loan { // loan request
  id: number; // order id

  borrower: AccountId;
  lender: AccountId;

  loan_duration: 10 | 20 | 30; // loan duration in days
  loan_interest_rate: number;
  loan_to_value_ratio: number; // loan to value ratio

  loan_amount: bigint;
  loan_interest: bigint;

  collateral_asset_id: string;
  collateral_asset_contract: AccountId;

  date_requested: bigint; // request for loan with collateral
  date_offered: bigint; // loan request in accepted, and $NEAR is offered
  date_started: bigint; // $NEAR is withdrawed, countdown starts
  date_redeemed: bigint; // $NEAR is paid back with interest
  date_liquidated: bigint; // liquidation, loan default, lender gets the collateral

  loan_status: "DRAFT" | "REQUESTED" | "OFFERED" | "STARTED" | "REDEEMED" | "LIQUIDATED";

}

const FIVE_TGAS = BigInt("50000000000000");
const TWENTY_TGAS = BigInt("20000000000000");
const THIRTY_TGAS = BigInt("30000000000000");
const NO_DEPOSIT = BigInt(0);
const NO_ARGS = JSON.stringify({});

@NearBindgen({})
class Broker {

  constructor() {
    this.loans_counter = 0;
    this.loans_map = new LookupMap<Loan>("loans");
    this.loans_by_borrowers = new LookupMap<Set<number>>("loans-by-borrowers");
    // this.loans_by_lenders = new LookupMap("loans-by-lenders");
    // this.loans_by_statuses = new LookupMap("loans-by-statuses");
  }

  loans_counter: number = 0;
  loans_map: LookupMap<Loan>;
  loans_by_borrowers: LookupMap<Set<number>>;
  // loans_by_lenders: LookupMap;
  // loans_by_statuses: LookupMap;

  @call({})
  nft_on_transfer({ sender_id, previous_owner_id, token_id, msg }: { sender_id: AccountId, previous_owner_id: AccountId, token_id: string, msg: string }) {
    assert(sender_id = previous_owner_id, "same?");

    const loan: Loan = {
      id: this.loans_counter,

      borrower: near.signerAccountId(),
      lender: "",

      loan_duration: 10,
      loan_interest_rate: 0.25,
      loan_to_value_ratio: 0.8,

      loan_amount: BigInt("1000000000000000000000000"),
      loan_interest: BigInt("0"),

      collateral_asset_id: token_id,
      collateral_asset_contract: near.predecessorAccountId(),

      date_requested: near.blockTimestamp(),
      date_offered: BigInt(0),
      date_started: BigInt(0),
      date_redeemed: BigInt(0),
      date_liquidated: BigInt(0),

      loan_status: "DRAFT"
    };

    this.loans_map.set("" + loan.id, loan);
    this.loans_counter++;

    let loans_by_borrower = this.loans_by_borrowers.get(loan.borrower);
    if (loans_by_borrower == null) loans_by_borrower = new Set<number>();

    loans_by_borrower.add(loan.id);
    this.loans_by_borrowers.set(loan.borrower, loans_by_borrower);

    // finalize transfer (by returning false)
    return false;
  }

  // edit loan request
  @call({})
  edit_request_loan({ loan_id, loan_amount, loan_duration, loan_interest_rate }: { loan_id: string; loan_amount: string; loan_duration: 10 | 20 | 30; loan_interest_rate: number; }): Loan {
    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "DRAFT" || "REQUESTED", "loan_status must be of DRAFT or REQUESTED");
    assert(loan.borrower === near.predecessorAccountId(), "only the borrower can request");

    loan.loan_amount = BigInt(loan_amount);
    loan.loan_duration = loan_duration;
    loan.loan_interest_rate = loan_interest_rate;
    loan.loan_status = "REQUESTED";
    this.loans_map.set(loan_id, loan);

    return loan;
  }

  @call({})
  cancel_request_loan({ loan_id }: { loan_id: string; }): NearPromise {
    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "DRAFT" || "REQUESTED", "loan_status must be of DRAFT or REQUESTED");
    assert(loan.borrower === near.predecessorAccountId(), "only the borrower can cancel");

    this.loans_map.remove(loan_id);

    let loans_by_borrower = this.loans_by_borrowers.get(loan.borrower);    
    loans_by_borrower?.delete(loan.id);
    this.loans_by_borrowers.set(loan.borrower, loans_by_borrower || new Set<number>());

    // send collateral back to borrower
    return NearPromise.new(loan.collateral_asset_contract)
      .functionCall("nft_transfer", JSON.stringify({ receiver_id: loan.borrower, token_id: loan.collateral_asset_id }), BigInt(1), TWENTY_TGAS)
      .asReturn();
  }

  @call({ payableFunction: true })
  offer_loan({ loan_id }: { loan_id: string; }): Loan {
    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "REQUESTED", "loan_status must be of REQUESTED");
    // assert that attached deposit is sufficient
    assert(loan.loan_amount === near.attachedDeposit(), "incorrect attached deposit for loan request");

    loan.lender = near.predecessorAccountId();
    loan.date_offered = near.blockTimestamp();
    loan.loan_amount = near.attachedDeposit();
    loan.loan_status = "OFFERED";

    this.loans_map.set(loan_id, loan);

    return loan;
  }

  @call({})
  cancel_offer_loan({ loan_id }: { loan_id: string; }): NearPromise {
    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "OFFERED", "loan_status must be of REQUESTED");
    assert(loan.lender === near.predecessorAccountId(), "only the lender can cancel the offer");

    loan.loan_status = "STARTED";
    loan.lender = "";
    loan.date_offered = BigInt(0);

    this.loans_map.set(loan_id, loan);

    // send $NEAR back to lender
    return NearPromise.new(loan.lender)
      .transfer(loan.loan_amount)
      .asReturn();
  }

  @call({})
  start_loan({ loan_id }: { loan_id: string }): NearPromise {

    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "OFFERED", "loan_status must be of OFFERED");
    assert(loan.date_started === BigInt(0), "already started");
    assert(loan.borrower === near.predecessorAccountId(), "loan can only be started by the borrower");

    loan.date_started = near.blockTimestamp();
    loan.loan_status = "STARTED";

    this.loans_map.set(loan_id, loan);

    // send $NEAR to borrower
    return NearPromise.new(loan.borrower)
      .transfer(loan.loan_amount)
      .asReturn();
  }

  // redeem loan - pay back the loan amount with interest within the timeframe
  // and get back the collateral
  @call({ payableFunction: true })
  redeem_loan({ loan_id }: { loan_id: string }): NearPromise {

    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "STARTED", "loan_status must be of STARTED");
    assert(loan.date_redeemed === BigInt(0), "already redeemed");
    assert(loan.date_started + BigInt(loan.loan_duration * 24 * 60 * 60 * 1000000000) >= near.blockTimestamp(), "redemption period is over");
    assert(loan.borrower === near.predecessorAccountId(), "loan can only be redeemed by the borrower");

    const interest = Number(loan.loan_amount) * (loan.loan_interest_rate * loan.loan_duration / 365);
    const payback = loan.loan_amount + BigInt(interest);
    assert(near.attachedDeposit() === payback, "payback must be loan + interest");

    loan.loan_interest = BigInt(interest);

    loan.date_redeemed = near.blockTimestamp();
    loan.loan_status = "REDEEMED";

    this.loans_map.set(loan_id, loan);

    // send collateral back to borrower
    return NearPromise.new(loan.collateral_asset_contract)
      .functionCall("nft_transfer", JSON.stringify({ receiver_id: loan.borrower, token_id: loan.collateral_asset_id }), BigInt(1), TWENTY_TGAS)
      .asReturn();
  }

  @call({})
  liquidate_loan({ loan_id }: { loan_id: string }): NearPromise {

    let loan = this.loans_map.get(loan_id);

    assert(loan.loan_status === "STARTED", "loan_status must be of STARTED");
    assert(loan.date_liquidated === BigInt(0), "already liquidated");
    assert(loan.date_started + BigInt(loan.loan_duration * 24 * 60 * 60 * 1000000000) < near.blockTimestamp(), "redemption period is not over yet");
    assert(loan.lender === near.predecessorAccountId(), "loan can only be liquidated by the lender");

    loan.date_liquidated = near.blockTimestamp();
    loan.loan_status = "LIQUIDATED";

    this.loans_map.set(loan_id, loan);

    // send collateral back to lender as borrower has defaulted
    return NearPromise.new(loan.collateral_asset_contract)
      .functionCall("nft_transfer", JSON.stringify({ receiver_id: loan.lender, token_id: loan.collateral_asset_id }), BigInt(1), TWENTY_TGAS)
      .asReturn();
  }

  @view({})
  get_loans(): Loan[] {
    return [this.loans_map.get("" + 0)];
  }

  @view({})
  get_loan({ loan_id }: { loan_id: string }): Loan {
    return this.loans_map.get(loan_id);
  }

  /*
  @call({})
  mpc_call_transfer_jpeg({ payload, path, key_version }: {
    payload: any[],
    path: string,
    key_version: number
  }): NearPromise {
    near.log("payload", payload)
    const argsString = JSON.stringify({ payload, path, key_version })
    near.log("argsString", argsString)
    const promise = NearPromise.new("multichain-testnet-2.testnet")
    .functionCall("sign", argsString, NO_DEPOSIT, FIVE_TGAS)
    .then(
      NearPromise.new(near.currentAccountId())
      .functionCall("mpc_call_transfer_jpeg_callback", NO_ARGS, NO_DEPOSIT, FIVE_TGAS)
    )
    
    return promise.asReturn();
  }

  @call({privateFunction: true})
  mpc_call_transfer_jpeg_callback(): String {
    let {result, success} = promiseResult()

    if (success) {
      return result;
    } else {
      near.log("Promise failed...")
      return ""
    }
  }*/
}

/*
function promiseResult(): {result: string, success: boolean}{
  let result, success;
  
  try{ result = near.promiseResult(0 as PromiseIndex); success = true }
  catch{ result = undefined; success = false }
  
  return {result, success}
}*/

// function restoreOwners(collection) {
//   if (collection == null) {
//       return null;
//   }
//   return UnorderedSet.deserialize(collection as UnorderedSet);
// }