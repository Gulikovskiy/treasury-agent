import type { Address } from "viem";
import { CHAINS, MANUAL_LABELS, TREASURY_WALLETS } from "../config.js";
import { fixturePath, isMain, writeJson } from "../lib/io.js";
import type { AddressLabelsFixture, ChainMap, ProtocolsFixture } from "../types/fixture.js";

export async function collectLabels(): Promise<{
  addressLabels: AddressLabelsFixture;
  protocols: ProtocolsFixture;
}> {
  const labelChains = {} as AddressLabelsFixture["chains"];
  const protocolChains = {} as ProtocolsFixture["chains"];

  for (const chain of Object.values(CHAINS)) {
    labelChains[chain.id] = {};
    protocolChains[chain.id] = { aave_v3: {} };

    for (const wallet of TREASURY_WALLETS[chain.id]) {
      labelChains[chain.id][wallet.toLowerCase()] = {
        label: "Treasury wallet",
        kind: "treasury",
        source: "config",
        controlled: true,
      };
    }

    for (const [key, value] of Object.entries(MANUAL_LABELS)) {
      const [rawChainId, address] = key.split(":");
      if (!rawChainId || !address || Number(rawChainId) !== chain.id) continue;
      labelChains[chain.id][address.toLowerCase()] = { ...value, source: "manual" };
    }

    const known: Record<string, Address | undefined> = {
      pool: chain.aave.POOL,
      collector: chain.aave.COLLECTOR,
      protocolDataProvider: chain.aave.AAVE_PROTOCOL_DATA_PROVIDER,
      poolAddressesProvider: chain.aave.POOL_ADDRESSES_PROVIDER,
      oracle: chain.aave.ORACLE,
    };

    for (const [role, address] of Object.entries(known)) {
      if (!address) continue;

      protocolChains[chain.id].aave_v3[role] = address;
      labelChains[chain.id][address.toLowerCase()] ??= {
        label: `Aave V3 ${role}`,
        kind: "protocol",
        protocol: "aave_v3",
        source: "@aave-dao/aave-address-book",
        controlled: role === "collector",
      };
    }
  }

  const addressLabels: AddressLabelsFixture = { chains: labelChains };
  const protocols: ProtocolsFixture = { chains: protocolChains };

  await writeJson(fixturePath("address_labels.json"), addressLabels);
  await writeJson(fixturePath("protocols.json"), protocols);
  return { addressLabels, protocols };
}

if (isMain(import.meta.url)) await collectLabels();
