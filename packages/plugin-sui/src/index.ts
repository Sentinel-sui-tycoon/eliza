import { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer.ts";
import { WalletProvider, walletProvider } from "./providers/wallet.ts";
import { SuiService } from "./services/sui.ts";
import swapToken from "./actions/swap.ts";
import { tradeEvaluator } from "./evaluators/tradeEvaluator.ts";

export { WalletProvider, transferToken as TransferSuiToken };

export const suiPlugin: Plugin = {
    name: "sui",
    description: "Sui Plugin for Eliza",
    actions: [transferToken, swapToken],
    evaluators: [tradeEvaluator],
    providers: [walletProvider],
    services: [new SuiService()],
};

export default suiPlugin;
