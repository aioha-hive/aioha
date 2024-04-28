import { VoteOperation } from '@hiveio/dhive'

export const createVote = (voter: string, author: string, permlink: string, weight: number): VoteOperation => {
  return ['vote', { voter, author, permlink, weight }]
}