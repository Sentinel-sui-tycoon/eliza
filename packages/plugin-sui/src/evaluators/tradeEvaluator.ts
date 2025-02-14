import {
    type ActionExample,
    booleanFooter,
    composeContext,
    type Content,
    elizaLogger,
    type Evaluator,
    generateObjectArray,
    generateTrueOrFalse,
    type IAgentRuntime,
    type Memory,
    MemoryManager,
    ModelClass,
} from "@elizaos/core";

const shouldProcessTemplate =
    `# Task: Decide if the recent messages should be processed for token recommendations.

    Look for messages that:
    - Mention specific token tickers or contract addresses
    - Contain words related to buying, selling, or trading tokens
    - Express opinions or convictions about tokens

    Based on the following conversation, should the messages be processed for recommendations? YES or NO

    {{recentMessages}}

    Should the messages be processed for recommendations? ` + booleanFooter;

export const formatRecommendations = (recommendations: Memory[]) => {
    const messageStrings = recommendations
        .reverse()
        .map((rec: Memory) => `${(rec.content as Content)?.content}`);
    const finalMessageStrings = messageStrings.join("\n");
    return finalMessageStrings;
};

const recommendationTemplate = `TASK: Extract recommendations to buy or sell memecoins from the conversation as an array of objects in JSON format.

    Memecoins usually have a ticker and a contract address. Additionally, recommenders may make recommendations with some amount of conviction. The amount of conviction in their recommendation can be none, low, medium, or high. Recommenders can make recommendations to buy, not buy, sell and not sell.

# START OF EXAMPLES
These are an examples of the expected output of this task:
{{evaluationExamples}}
# END OF EXAMPLES

# INSTRUCTIONS

Extract any new recommendations from the conversation that are not already present in the list of known recommendations below:
{{recentRecommendations}}

- Include the recommender's username
- Try not to include already-known recommendations. If you think a recommendation is already known, but you're not sure, respond with alreadyKnown: true.
- Set the conviction to 'none', 'low', 'medium' or 'high'
- Set the recommendation type to 'buy', 'dont_buy', 'sell', or 'dont_sell'
- Include the contract address and/or ticker if available

Recent Messages:
{{recentMessages}}

Response should be a JSON object array inside a JSON markdown block. Correct response format:
\`\`\`json
[
  {
    "recommender": string,
    "ticker": string | null,
    "contractAddress": string | null,
    "type": enum<buy|dont_buy|sell|dont_sell>,
    "conviction": enum<none|low|medium|high>,
    "alreadyKnown": boolean
  },
  ...
]
\`\`\``;

async function handler(runtime: IAgentRuntime, message: Memory) {
    elizaLogger.log("Evaluating for trust");
    const state = await runtime.composeState(message);

    // if the database type is postgres, we don't want to run this because it relies on sql queries that are currently specific to sqlite. This check can be removed once the trust score provider is updated to work with postgres.
    if (runtime.getSetting("POSTGRES_URL")) {
        elizaLogger.warn("skipping trust evaluator because db is postgres");
        return [];
    }

    const { agentId, roomId } = state;

    // Check if we should process the messages
    const shouldProcessContext = composeContext({
        state,
        template: shouldProcessTemplate,
    });

    const shouldProcess = await generateTrueOrFalse({
        context: shouldProcessContext,
        modelClass: ModelClass.SMALL,
        runtime,
    });

    if (!shouldProcess) {
        elizaLogger.log("Skipping process");
        return [];
    }

    elizaLogger.log("Processing recommendations");

    // Get recent recommendations
    const recommendationsManager = new MemoryManager({
        runtime,
        tableName: "recommendations",
    });

    const recentRecommendations = await recommendationsManager.getMemories({
        roomId,
        count: 20,
    });

    const context = composeContext({
        state: {
            ...state,
            recentRecommendations: formatRecommendations(recentRecommendations),
        },
        template: recommendationTemplate,
    });

    const recommendations = await generateObjectArray({
        runtime,
        context,
        modelClass: ModelClass.LARGE,
    });

    elizaLogger.log("recommendations", recommendations);

    if (!recommendations) {
        return [];
    }

    // If the recommendation is already known or corrupted, remove it
    const filteredRecommendations = recommendations.filter((rec) => {
        return (
            !rec.alreadyKnown &&
            (rec.ticker || rec.contractAddress) &&
            rec.recommender &&
            rec.conviction &&
            rec.recommender.trim() !== ""
        );
    });

    return filteredRecommendations;
}

export const tradeEvaluator: Evaluator = {
    name: "EXTRACT_RECOMMENDATIONS",
    similes: [
        "GET_RECOMMENDATIONS",
        "EXTRACT_TOKEN_RECS",
        "EXTRACT_MEMECOIN_RECS",
    ],
    alwaysRun: true,
    validate: async (
        runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        elizaLogger.info("====> EVALUATING SUI TRADE EVALUATOR");
        if (message.content.text.length < 5) {
            return false;
        }

        return message.userId !== message.agentId;
    },
    description:
        "Extract recommendations to buy or sell memecoins/tokens from the conversation, including details like ticker, contract address, conviction level, and recommender username.",
    handler,
    examples: [
        {
            context: `Actors in the scene:
{{user1}}: Experienced DeFi degen. Constantly chasing high yield farms.
{{user2}}: New to DeFi, learning the ropes.

Recommendations about the actors:
None`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "Yo, have you checked out $SUIARUG? Dope new yield aggregator on sui.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Nah, I'm still trying to wrap my head around how yield farming even works haha. Is it risky?",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "I mean, there's always risk in DeFi, but the $SUIARUG devs seem legit. Threw a few sui into the FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9 vault, farming's been smooth so far.",
                    },
                },
            ] as ActionExample[],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "SUIARUG",
    "contractAddress": "FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9",
    "type": "buy",
    "conviction": "medium",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: sui maximalist. Believes sui will flip Ethereum.
{{user2}}: Multichain proponent. Holds both SUI and ETH.

Recommendations about the actors:
{{user1}} has previously promoted $COPETOKEN and $SOYLENT.`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "If you're not long $SUIVAULT at 7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx, you're missing out. This will be the blackhole of sui liquidity.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Idk man, feels like there's a new 'vault' or 'reserve' token every week on Sol. What happened to $COPETOKEN and $SOYLENT that you were shilling before?",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "$COPETOKEN and $SOYLENT had their time, I took profits near the top. But $SUIVAULT is different, it has actual utility. Do what you want, but don't say I didn't warn you when this 50x's and you're left holding your $ETH bags.",
                    },
                },
            ] as ActionExample[],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "COPETOKEN",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low",
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SOYLENT",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low",
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SUIVAULT",
    "contractAddress": "7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: Self-proclaimed sui alpha caller. Allegedly has insider info.
{{user2}}: Degen gambler. Will ape into any hyped token.

Recommendations about the actors:
None`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "I normally don't do this, but I like you anon, so I'll let you in on some alpha. $ROULETTE at 48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2 is going to absuiutely send it soon. You didn't hear it from me 🤐",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Oh shit, insider info from the alpha god himself? Say no more, I'm aping in hard.",
                    },
                },
            ] as ActionExample[],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "ROULETTE",
    "contractAddress": "48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: NFT collector and trader. Bullish on sui NFTs.
{{user2}}: Only invests based on fundamentals. Sees all NFTs as worthless JPEGs.

Recommendations about the actors:
None
`,
            messages: [
                {
                    user: "{{user1}}",
                    content: {
                        text: "GM. I'm heavily accumulating $PIXELAPE, the token for the Pixel Ape Yacht Club NFT collection. 10x is inevitable.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "NFTs are a scam bro. There's no underlying value. You're essentially trading worthless JPEGs.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Fun staying poor 🤡 $PIXELAPE is about to moon and you'll be left behind.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Whatever man, I'm not touching that shit with a ten foot pole. Have fun holding your bags.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Don't need luck where I'm going 😎 Once $PIXELAPE at 3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc takes off, you'll change your tune.",
                    },
                },
            ],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "PIXELAPE",
    "contractAddress": "3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },

        {
            context: `Actors in the scene:
{{user1}}: Contrarian investor. Bets against hyped projects.
{{user2}}: Trend follower. Buys tokens that are currently popular.

Recommendations about the actors:
None`,
            messages: [
                {
                    user: "{{user2}}",
                    content: {
                        text: "$SAMOYED is the talk of CT right now. Making serious moves. Might have to get a bag.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Whenever a token is the 'talk of CT', that's my cue to short it. $SAMOYED is going to dump hard, mark my words.",
                    },
                },
                {
                    user: "{{user2}}",
                    content: {
                        text: "Idk man, the hype seems real this time. 5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr chart looks bullish af.",
                    },
                },
                {
                    user: "{{user1}}",
                    content: {
                        text: "Hype is always real until it isn't. I'm taking out a fat short position here. Don't say I didn't warn you when this crashes 90% and you're left holding the flaming bags.",
                    },
                },
            ],
            outcome: `\`\`\`json
[
  {
    "recommender": "{{user2}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "buy",
    "conviction": "medium",
    "alreadyKnown": false
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "dont_buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``,
        },
    ],
};
