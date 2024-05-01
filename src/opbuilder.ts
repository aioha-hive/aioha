import { CommentOperation, CommentOptionsOperation, CustomJsonOperation, VoteOperation, DeleteCommentOperation } from '@hiveio/dhive'

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