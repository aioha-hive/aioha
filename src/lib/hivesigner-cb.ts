export const hivesignerCb = () => {
  let url = new URL(window.location.href)
  let txid = url.searchParams.get('id')
  if (txid) {
    localStorage.setItem('hivesignerTxId', txid)
  } else {
    localStorage.setItem('hivesignerToken', url.searchParams.get('access_token') || '')
    localStorage.setItem(
      'hivesignerExpiry',
      Math.floor(new Date().getTime() / 1000 + parseInt(url.searchParams.get('expires_in') || '0')).toString()
    )
    localStorage.setItem('hivesignerUsername', url.searchParams.get('username') || '')
  }
  setTimeout(() => window.close(), 1000)
}
