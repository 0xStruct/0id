import styles from '@/styles/app.module.css';
import AuctionItem from '@/components/AuctionItem';
import Timer from '@/components/Timer';
import Bid from '@/components/Bid';
import { useContext, useEffect, useState } from 'react';
import SkeletonAuctionItem from '@/components/Skeletons/SkeletonAuctionItem';
import SkeletonTimer from '@/components/Skeletons/SkeletonTimer';
import SkeletonBid from '@/components/Skeletons/SkeletonBid';
import { NearContext } from '@/context';
import { AUCTION_CONTRACT } from '@/config';
import { BROKER_CONTRACT } from '@/config';
import { CKT_TOKEN_CONTRACT } from '@/config';
import { CKT_SIGNER_CONTRACT } from '@/config';
import LastBid from '@/components/LastBid';

export default function Home() {
  const { signedAccountId } = useContext(NearContext);

  const [tokens, setTokens] = useState(null)
  const [storageBalance, setStorageBalance] = useState({ total: 0, available: 0 })
  const nearMultiplier = Math.pow(10, 24)

  const { wallet } = useContext(NearContext);

  useEffect(() => {
    const getTokens = async () => {
      if (signedAccountId) {
        const data = await wallet.viewMethod({
          contractId: CKT_TOKEN_CONTRACT,
          method: "nft_tokens_for_owner",
          args: { account_id: signedAccountId }
        });
        setTokens(data)
        console.log("tokens", data)
      }
    }

    getTokens();

    const getStorageBalance = async () => {
      if (signedAccountId) {
        const data = await wallet.viewMethod({
          contractId: CKT_TOKEN_CONTRACT,
          method: "storage_balance_of",
          args: { account_id: signedAccountId }
        });
        setStorageBalance(data)
        console.log("storageBalance", data)
      }
    }

    getStorageBalance();

  }, [signedAccountId]);

  // deposit for storage
  const handle_storage_deposit = async () => {
    if (signedAccountId) {
      let real_amount = 1 * nearMultiplier
      let response = await wallet.callMethod({
        contractId: CKT_TOKEN_CONTRACT,
        method: "storage_deposit",
        deposit: real_amount,
        args: {},
        gas: "300000000000000"
      })
      return response
    } else {
      toast("Please sign in first");
    }
  }

  const handle_mint = async () => {
    if (signedAccountId) {
      let response = await wallet.callMethod({
        contractId: CKT_TOKEN_CONTRACT,
        method: "mint",
        gas: "300000000000000"
      })
      return response
    } else {
      toast("Please sign in first");
    }
  }

  const handle_loan_request = async (token_id) => {
    if (signedAccountId) {
      let response = await wallet.callMethod({
        contractId: CKT_TOKEN_CONTRACT,
        method: "nft_transfer_call",
        args: { "receiver_id": BROKER_CONTRACT, "token_id": token_id, "memo": "request loan", "msg": "" },
        deposit: 1,
        gas: "300000000000000"
      })
      return response
    } else {
      toast("Please sign in first");
    }
  }

  const listTokens = tokens?.map(token =>
    <li>
      {token.token_id + ": " + token.metadata.title + " " + token.owner_id}
      <button onClick={() => handle_loan_request(token.token_id)}>
        $ Get Loan
      </button>
    </li>
  );

  // const fetchPastBids = async () => {
  //     const response = await fetch(`/api/getBidHistory?contractId=${AUCTION_CONTRACT}&ftId=${ftContract}`);
  //     const data = await response.json();
  //     if (data.error) {
  //       setPastBids(data.error);
  //     } else {
  //       setPastBids(data.pastBids);
  //     }
  // }

  return (
    <main className={styles.main}>
      <div className={styles.leftPanel}>
        <div>leftPanel</div>
        <ul>
          {listTokens}
        </ul>

      </div>
      <div className={styles.rightPanel}>

        <div>rightPanel</div>
        {!storageBalance.available &&
          <button onClick={handle_storage_deposit}>
            DEPOSIT
          </button>
        }

        {storageBalance.available &&
          <button onClick={handle_mint}>
            MINT
          </button>
        }
      </div>
    </main>

  );
}