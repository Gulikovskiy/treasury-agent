import type { Address } from 'viem'

export interface AccountPage<T> {
  status?: string
  message?: string
  result?: T[] | string
  [key: string]: unknown
}

export interface NormalTransaction {
  hash?: `0x${string}`
  from?: Address
  to?: Address
  contractAddress?: Address
  input?: `0x${string}`
  value?: string
  gasUsed?: string
  gasPrice?: string
  blockNumber?: string
  timeStamp?: string
  [key: string]: unknown
}

export interface Erc20Transfer {
  hash?: `0x${string}`
  from?: Address
  to?: Address
  contractAddress?: Address
  tokenSymbol?: string
  tokenDecimal?: string
  value?: string
  blockNumber?: string
  timeStamp?: string
  [key: string]: unknown
}

export interface AccountHistoryResult<T> {
  items: T[]
  pages: AccountPage<T>[]
}

export interface AccountHistoryRange {
  fromBlock: string
  toBlock: string
}
