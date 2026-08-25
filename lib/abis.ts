import { parseAbi } from 'viem'

export const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

export const AAVE_DATA_PROVIDER_ABI = [
  {
    type: 'function',
    name: 'getAllReservesTokens',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      name: '',
      type: 'tuple[]',
      components: [
        { name: 'symbol', type: 'string' },
        { name: 'tokenAddress', type: 'address' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'getUserReserveData',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'currentATokenBalance', type: 'uint256' },
      { name: 'currentStableDebt', type: 'uint256' },
      { name: 'currentVariableDebt', type: 'uint256' },
      { name: 'principalStableDebt', type: 'uint256' },
      { name: 'scaledVariableDebt', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'stableRateLastUpdated', type: 'uint40' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
    ],
  },
] as const
