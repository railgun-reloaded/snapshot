// Shapes compatible with @railgun-reloaded/scanner EVM types
type SnapshotEVMLog = {
  index: number
  address: string
  name: string
  args: Record<string, any>
}

type SnapshotEVMTransaction = {
  hash: string
  index: number
  from: string
  logs: SnapshotEVMLog[]
}

type SnapshotEVMBlock = {
  number: bigint
  hash: string
  timestamp: bigint
  transactions: SnapshotEVMTransaction[]
  internalTransaction: { tracePath: number[]; from: string }[]
}

export type { SnapshotEVMLog, SnapshotEVMTransaction, SnapshotEVMBlock }
