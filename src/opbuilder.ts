import {
  CommentOperation,
  CommentOptionsOperation,
  CustomJsonOperation,
  VoteOperation,
  DeleteCommentOperation,
  TransferOperation,
  RecurrentTransferOperation,
  TransferToVestingOperation,
  WithdrawVestingOperation,
  DelegateVestingSharesOperation,
  AccountWitnessVoteOperation,
  AccountWitnessProxyOperation,
  UpdateProposalVotesOperation
} from '@hiveio/dhive'
import { Asset } from './types'
import { getAccounts, hivePerVests } from './rpc'

const VESTS_DECIMALS = 6

export const createVote = (voter: string, author: string, permlink: string, weight: number): VoteOperation => {
  return ['vote', { voter, author, permlink, weight }]
}

export const createCommentOptions = (options: CommentOptionsOperation[1]): CommentOptionsOperation => ['comment_options', options]
export const createComment = (pa: string | null,
  pp: string | null,
  author: string,
  permlink: string,
  title: string,
  body: string,
  json: string | object,
  options?: CommentOptionsOperation[1]): [CommentOperation, CommentOptionsOperation?] => {
    if (typeof json === 'object')
      json = JSON.stringify(json)
    const result: [CommentOperation, CommentOptionsOperation?] = [
      ['comment', {
        parent_author: pa ?? '',
        parent_permlink: pp ?? '',
        author,
        permlink,
        title,
        body,
        json_metadata: json
      }]
    ]
    if (options)
      result.push(createCommentOptions(options))
    return result
  }

export const createCustomJSON = (required_auths: string[], required_posting_auths: string[], id: string, json: string): CustomJsonOperation => {
  return ['custom_json', { required_auths, required_posting_auths, id, json }]
}

export const deleteComment = (author: string, permlink: string): DeleteCommentOperation => {
  return ['delete_comment', { author, permlink }]
}

export const createXfer = (from: string, to: string, amount: number, currency: Asset, memo?: string): TransferOperation => {
  return ['transfer', { from, to, amount: amount.toFixed(3)+' '+currency, memo: memo ?? '' }]
}

export const createRecurrentXfer = (from: string, to: string, amount: number, currency: Asset, recurrence: number, executions: number, memo?: string): RecurrentTransferOperation => {
  return ['recurrent_transfer', { from, to, amount: amount.toFixed(3)+' '+currency, recurrence, executions, memo: memo ?? '', extensions: [] }]
}

export const createStakeHive = (from: string, to: string, amount: number): TransferToVestingOperation => {
  return ['transfer_to_vesting', { from, to, amount: amount.toFixed(3)+' HIVE' }]
}

export const createUnstakeHive = async (account: string, amount: number): Promise<WithdrawVestingOperation> => {
  const accResp = await getAccounts([account])
  const hpv = await hivePerVests()
  if (accResp.error)
    throw new Error(accResp.error)
  let vestsToUnstake = amount/hpv
  const availVestsFloor = (Math.round(parseFloat(accResp.result[0].vesting_shares)*Math.pow(10,VESTS_DECIMALS)) - Math.round(parseFloat(accResp.result[0].delegated_vesting_shares)*Math.pow(10,VESTS_DECIMALS)))/Math.pow(10,VESTS_DECIMALS)
  if (vestsToUnstake >= availVestsFloor)
    vestsToUnstake = availVestsFloor
  return createUnstakeHiveByVests(account, vestsToUnstake)
}

export const createUnstakeHiveByVests = (account: string, vests: number): WithdrawVestingOperation => {
  return ['withdraw_vesting', { account, vesting_shares: vests.toFixed(6)+' VESTS' }]
}

export const createDelegateVests = (delegator: string, delegatee: string, amount: number): DelegateVestingSharesOperation => {
  return ['delegate_vesting_shares', { delegator, delegatee, vesting_shares: amount.toFixed(6)+' VESTS' }]
}

export const createVoteWitness = (account: string, witness: string, approve: boolean): AccountWitnessVoteOperation => {
  return ['account_witness_vote', { account, witness, approve }]
}

export const createVoteProposals = (voter: string, proposals: number[], approve: boolean): UpdateProposalVotesOperation => {
  return ['update_proposal_votes', { voter, proposal_ids: proposals, approve, extensions: [] }]
}

export const createSetProxy = (account: string, proxy: string): AccountWitnessProxyOperation => {
  return ['account_witness_proxy', { account, proxy }]
}