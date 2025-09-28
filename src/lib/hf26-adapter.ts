import type { CommentOptionsOperation, Operation, Asset as OldAsset, PriceType as OldPriceType, Transaction } from '@hiveio/dhive'
import type { HF26Operation, Asset, PriceType, HF26Transaction } from './hf26-types.js'

const toNai = (asset: string | OldAsset): Asset => {
  asset = asset.toString()
  const [amt, symb] = asset.split(' ')
  const mamt = parseFloat(amt)
  switch (symb) {
    case 'HIVE':
    case 'TESTS':
      return {
        amount: Math.round(mamt * 1000).toString(),
        nai: '@@000000021',
        precision: 3
      }
    case 'HBD':
    case 'TBD':
      return {
        amount: Math.round(mamt * 1000).toString(),
        nai: '@@000000013',
        precision: 3
      }
    case 'VESTS':
      return {
        amount: Math.round(mamt * 1000000).toString(),
        nai: '@@000000037',
        precision: 6
      }
    default:
      throw new Error('invalid asset')
  }
}

const toNewPrice = (oldPrice: OldPriceType): PriceType => {
  return {
    base: toNai(oldPrice.base),
    quote: toNai(oldPrice.quote)
  }
}

/**
 * Convert legacy operation to HF26 operation.
 * @param oldOperation Old operation
 * @returns HF26 operation
 */
export const oldToHF26Operation = (oldOperation: Operation): HF26Operation => {
  const oldName = oldOperation[0]
  const newName = (oldName + '_operation') as HF26Operation['type']
  const newBody = structuredClone(oldOperation[1])

  switch (oldName) {
    case 'account_create':
      newBody.fee = toNai(newBody.fee)
      break
    case 'claim_reward_balance':
      newBody.reward_hive = toNai(newBody.reward_hive)
      newBody.reward_hbd = toNai(newBody.reward_hbd)
      newBody.reward_vests = toNai(newBody.reward_vests)
      break
    case 'claim_account':
      newBody.fee = toNai(newBody.fee)
      break
    case 'comment_options':
      newBody.max_accepted_payout = toNai(newBody.max_accepted_payout)
      newBody.extensions = (newBody.extensions as CommentOptionsOperation[1]['extensions']).map((b) => {
        return {
          type: 'comment_payout_beneficiaries',
          value: b[1]
        }
      })
      break
    case 'convert':
    case 'transfer':
    case 'transfer_from_savings':
    case 'transfer_to_savings':
    case 'transfer_to_vesting':
    case 'recurrent_transfer':
    case 'collateralized_convert':
      newBody.amount = toNai(newBody.amount)
      break
    case 'delegate_vesting_shares':
    case 'withdraw_vesting':
      newBody.vesting_shares = toNai(newBody.vesting_shares)
      break
    case 'escrow_release':
      newBody.hbd_amount = toNai(newBody.hbd_amount)
      newBody.hive_amount = toNai(newBody.hive_amount)
      break
    case 'escrow_transfer':
      newBody.hbd_amount = toNai(newBody.hbd_amount)
      newBody.hive_amount = toNai(newBody.hive_amount)
      newBody.fee = toNai(newBody.fee)
      break
    case 'feed_publish':
      newBody.exchange_rate = toNewPrice(newBody.exchange_rate)
      break
    case 'limit_order_create':
      newBody.amount_to_sell = toNai(newBody.amount_to_sell)
      newBody.min_to_receive = toNai(newBody.min_to_receive)
      break
    case 'limit_order_create2':
      newBody.amount_to_sell = toNai(newBody.amount_to_sell)
      newBody.exchange_rate = toNewPrice(newBody.exchange_rate)
      break
    case 'witness_update':
      newBody.fee = toNai(newBody.fee)
      newBody.props.account_creation_fee = toNai(newBody.props.account_creation_fee)
      break
    case 'create_proposal':
      newBody.daily_pay = toNai(newBody.daily_pay)
      break
    case 'update_proposal':
      newBody.daily_pay = toNai(newBody.daily_pay)
      newBody.extensions = newBody.extensions.map((ext: any) => {
        return {
          type: 'update_proposal_end_date',
          value: ext[1]
        }
      })
      break
  }

  return {
    type: newName,
    //@ts-ignore
    value: newBody
  }
}

export const oldToHF26Tx = (oldTx: Transaction): HF26Transaction => {
  return {
    ref_block_num: oldTx.ref_block_num,
    ref_block_prefix: oldTx.ref_block_prefix,
    expiration: oldTx.expiration,
    operations: oldTx.operations.map((op) => oldToHF26Operation(op)),
    extensions: oldTx.extensions
  }
}
