const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const fetch = require('node-fetch');
const ALFALF_SYSTEM_PROMPT = require('./prompt');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const WELCOME_MESSAGE = `
🌱 Welcome to Alfalf AI

I'm a Campaign Intelligence System for Web3 projects.
Not generic tasks — real participation systems.

Send your project details in this format:

Project: (your project name)
Goal: (what you want to achieve)
Duration: (how long the campaign runs)

Example:
Project: DeFi lending protocol
Goal: Increase TVL and retain users
Duration: 3 weeks
`;

const REWARD_QUESTION = `
Would you like me to design a fair reward structure for this campaign? 🎯

Reply with Yes or No.
`;

const REFINE_MESSAGE = `
Want to go deeper? Here's what I can help you refine:

- Improve retention design
- Reduce farming risk
- Adjust reward structure
- Rethink a weak phase

Just tell me what you'd like to optimize — or send a new project brief to start fresh.
`;

const REWARD_ANALYSIS_PROMPT = `
You are Alfalf AI — a Reward Structure Architect for Web3 campaigns.
You will receive a reward tier breakdown with exact dollar calculations already done.
Your job is to analyze the structure and provide strategic commentary only.

Provide exactly these sections:

1. 🏆 Recommended Model
State which reward model this represents and why it fits the campaign.
Choose from: Tiered distribution, Hybrid leaderboard + raffle, Broad participation, Contribution-based.

2. ⚠️ Favoritism Risk Flags
Identify if the structure could be exploited by internal teams.
Suggest transparency measures.

3. 🤖 Farming Risk Flags
Identify if the structure encourages multi-accounting or bot farming.
Suggest effort-based qualifications.

4. 🎲 Raffle Evaluation
NOT every campaign deserves a raffle. Evaluate carefully.
Raffle works for high-volume, contribution-based, broad participation campaigns.
Raffle does not work for low-effort tasks, small pools, or quality-focused campaigns.
State clearly if raffle fits or not, and why.

5. ⚠️ Insight
One key insight on fairness or retention value. 2–3 sentences maximum.
`;

const userStates = {};

function sendLongMessage(chatId, text) {
  const maxLength = 4000;
  for (let i = 0; i < text.length; i += maxLength) {
    setTimeout(() => {
      bot.sendMessage(chatId, text.substring(i, i + maxLength));
    }, (i / maxLength) * 500);
  }
}

function parseRewardInput(text) {
  const poolMatch = text.match(/reward\s*pool[:\s]*\$?([\d,]+)/i);
  const winnersMatch = text.match(/winners?[:\s]*([\d,]+)/i);
  if (!poolMatch || !winnersMatch) return null;
  const pool = parseFloat(poolMatch[1].replace(/,/g, ''));
  const winners = parseInt(winnersMatch[1].replace(/,/g, ''));
  if (isNaN(pool) || isNaN(winners) || pool <= 0 || winners <= 0) return null;
  return { pool, winners };
}

function showProjectTypeButtons(chatId) {
  bot.sendMessage(chatId, '🏗 What type of Web3 project is this?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'DeFi', callback_data: 'type_DeFi' },
          { text: 'GameFi', callback_data: 'type_GameFi' }
        ],
        [
          { text: 'AI', callback_data: 'type_AI' },
          { text: 'DeSci', callback_data: 'type_DeSci' }
        ],
        [
          { text: 'Custom', callback_data: 'type_Custom' }
        ]
      ]
    }
  });
}

function showPlatformButtons(chatId) {
  bot.sendMessage(chatId, '📡 Where will this campaign be hosted?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Zealy', callback_data: 'platform_Zealy' },
          { text: 'Galxe', callback_data: 'platform_Galxe' }
        ],
        [
          { text: 'X (Twitter)', callback_data: 'platform_X' },
          { text: 'Discord', callback_data: 'platform_Discord' }
        ],
        [
          { text: 'Telegram', callback_data: 'platform_Telegram' },
          { text: 'Custom', callback_data: 'platform_Custom' }
        ]
      ]
    }
  });
}

async function generateCampaign(chatId) {
  const state = userStates[chatId];
  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your campaign system...');

  try {
    const response = await fetch(`${BASE_URL}/api/campaign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: String(chatId),
        projectName: state.project,
        goal: state.goal,
        duration: state.duration,
        projectType: state.projectType,
        platform: state.platform
      })
    });

    const data = await response.json();

    if (data.campaignOutput) {
      sendLongMessage(chatId, data.campaignOutput);

      userStates[chatId] = {
        step: 'awaiting_reward_confirmation',
        lastCampaign: data.campaignOutput,
        lastInput: `Project: ${state.project}`,
        campaignId: data.campaignId
      };

      setTimeout(() => {
        bot.sendMessage(chatId, `🔗 View your campaign audit:\nhttps://alfalf-audit.vercel.app/campaign/${data.campaignId}`);
      }, 800);

      setTimeout(() => {
        bot.sendMessage(chatId, REWARD_QUESTION);
      }, 1600);

    } else {
      bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again.');
    }
  } catch (error) {
    console.error('Campaign generation error:', error);
    bot.sendMessage(chatId, '⚠️ Something went wrong while generating your campaign. Please try again.');
  }
}

// Handle button callbacks
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  const state = userStates[chatId];

  // Project type selection
  if (data.startsWith('type_')) {
    const selected = data.replace('type_', '');

    if (selected === 'Custom') {
      userStates[chatId] = { ...state, step: 'awaiting_custom_type' };
      bot.sendMessage(chatId, '✏️ Please type your custom project type:');
      return;
    }

    userStates[chatId] = { ...state, projectType: selected, step: 'awaiting_platform' };
    bot.editMessageText(`✅ Project type: ${selected}`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    showPlatformButtons(chatId);
    return;
  }

  // Platform selection
  if (data.startsWith('platform_')) {
    const selected = data.replace('platform_', '');

    if (selected === 'Custom') {
      userStates[chatId] = { ...state, step: 'awaiting_custom_platform' };
      bot.sendMessage(chatId, '✏️ Please type your custom campaign platform:');
      return;
    }

    userStates[chatId] = { ...state, platform: selected, step: 'generating' };
    bot.editMessageText(`✅ Platform: ${selected}`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    await generateCampaign(chatId);
    return;
  }

  // No-reward path buttons
  if (data === 'no_refine') {
    userStates[chatId] = { ...state, step: 'awaiting_refinement' };
    bot.editMessageText(`🔧 Let's refine your campaign.`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    bot.sendMessage(chatId, REFINE_MESSAGE);
    return;
  }

  if (data === 'no_new') {
    delete userStates[chatId];
    bot.editMessageText(`🧪 Starting fresh.`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    bot.sendMessage(chatId, WELCOME_MESSAGE);
    return;
  }

  if (data === 'no_close') {
    delete userStates[chatId];
    bot.editMessageText(`✅ Session closed.`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    bot.sendMessage(chatId, `Got it 👍\n\nWhenever you're ready to design or test a new campaign, just hit /start.`);
    return;
  }
});

bot.onText(/\/start/, (msg) => {
  delete userStates[msg.chat.id];
  bot.sendMessage(msg.chat.id, WELCOME_MESSAGE);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates[chatId];
  const step = state?.step;

  // Custom project type input
  if (step === 'awaiting_custom_type') {
    userStates[chatId] = { ...state, projectType: `Custom: ${text}`, step: 'awaiting_platform' };
    bot.sendMessage(chatId, `✅ Project type saved: ${text}`);
    showPlatformButtons(chatId);
    return;
  }

  // Custom platform input
  if (step === 'awaiting_custom_platform') {
    userStates[chatId] = { ...state, platform: `Custom: ${text}`, step: 'generating' };
    bot.sendMessage(chatId, `✅ Platform saved: ${text}`);
    await generateCampaign(chatId);
    return;
  }

  // Refinement flow
  if (step === 'awaiting_refinement') {
    userStates[chatId].step = null;
    bot.sendChatAction(chatId, 'typing');
    bot.sendMessage(chatId, '🔧 Refining your campaign...');

    try {
      const campaignId = state?.campaignId;

      const response = await fetch(`${BASE_URL}/api/campaign/${campaignId}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: text })
      });

      const data = await response.json();

      if (data.output) {
        sendLongMessage(chatId, data.output);
        userStates[chatId] = { ...state, step: 'awaiting_refinement' };
        setTimeout(() => {
          bot.sendMessage(chatId, REFINE_MESSAGE);
        }, 1000);
      } else {
        bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again.');
      }
    } catch (error) {
      console.error('Refinement error:', error);
      bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again.');
    }
    return;
  }

  // Reward pool input
  if (step === 'awaiting_reward') {
    const parsed = parseRewardInput(text);

    if (!parsed) {
      bot.sendMessage(chatId, `⚠️ I couldn't read your reward details. Please use this format:

💰 Reward pool: $500
🏆 Number of winners: 20`);
      return;
    }

    userStates[chatId].step = null;
    bot.sendChatAction(chatId, 'typing');
    bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your reward structure...');

    try {
      const campaignId = state?.campaignId;
      const lastCampaign = state?.lastCampaign || '';

      const response = await fetch(`${BASE_URL}/api/campaign/${campaignId}/reward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardPool: parsed.pool, winners: parsed.winners })
      });

      const data = await response.json();

      if (data.tiers) {
        let breakdown = '📊 Practical Breakdown:\n';
        for (const tier of data.tiers) {
          breakdown += `Winners ${tier.range} → $${tier.perUser} each\n`;
        }
        breakdown += `Total Winners → ${data.totalWinners}\n`;
        breakdown += `Total Payout → $${data.rewardPool}`;

        // Get analysis from AI
        const analysisResponse = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: REWARD_ANALYSIS_PROMPT },
            {
              role: 'user',
              content: `Campaign context:\n${lastCampaign}\n\nReward pool: $${parsed.pool}\nNumber of winners: ${parsed.winners}\n\nCalculated breakdown:\n${breakdown}`
            }
          ],
          temperature: 0.7,
          max_tokens: 1000,
        });

        const analysis = analysisResponse.choices[0]?.message?.content;

        if (analysis) {
          const fullOutput = `${breakdown}\n\n${analysis}`;
          sendLongMessage(chatId, fullOutput);
        } else {
          sendLongMessage(chatId, breakdown);
        }

        userStates[chatId] = { ...state, step: 'awaiting_refinement' };
        setTimeout(() => {
          bot.sendMessage(chatId, REFINE_MESSAGE);
        }, 2000);

      } else {
        bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again.');
      }

    } catch (error) {
      console.error('Reward error:', error);
      bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again.');
    }
    return;
  }

  // Yes/No for reward confirmation
  if (step === 'awaiting_reward_confirmation') {
    const cleaned = text.toLowerCase().trim();
    const isYes = ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay'].includes(cleaned);
    const isNo = ['no', 'n', 'nah', 'nope'].includes(cleaned);

    if (isYes) {
      userStates[chatId].step = 'awaiting_reward';
      bot.sendMessage(chatId, `💰 Please provide your reward details:

💰 Reward pool: $0000
🏆 Number of winners: 000

Example:
💰 Reward pool: $500
🏆 Number of winners: 20`);
      return;
    }

    if (isNo) {
      userStates[chatId] = { ...state, step: 'awaiting_no_action' };
      bot.sendMessage(chatId, `Got it 👍\n\nWhat would you like to do next?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔧 Refine Campaign', callback_data: 'no_refine' }],
            [{ text: '🧪 Test New Campaign', callback_data: 'no_new' }],
            [{ text: '❌ Close', callback_data: 'no_close' }]
          ]
        }
      });
      return;
    }

    bot.sendMessage(chatId, `Please reply with Yes or No.\n\nWould you like me to design a fair reward structure for this campaign? 🎯`);
    return;
  }

  // Default: expect new campaign input
  const hasProject = text.toLowerCase().includes('project:');
  const hasGoal = text.toLowerCase().includes('goal:');
  const hasDuration = text.toLowerCase().includes('duration:');

  if (!hasProject || !hasGoal || !hasDuration) {
    bot.sendMessage(chatId, `⚠️ Please use the correct format:

Project: (your project name)
Goal: (what you want to achieve)
Duration: (how long the campaign runs)

Example:
Project: DeFi lending protocol
Goal: Increase TVL and retain users
Duration: 3 weeks`);
    return;
  }

  // Parse campaign input
  const projectMatch = text.match(/project:\s*(.+)/i);
  const goalMatch = text.match(/goal:\s*(.+)/i);
  const durationMatch = text.match(/duration:\s*(.+)/i);

  userStates[chatId] = {
    step: 'awaiting_project_type',
    project: projectMatch ? projectMatch[1].trim() : '',
    goal: goalMatch ? goalMatch[1].trim() : '',
    duration: durationMatch ? durationMatch[1].trim() : ''
  };

  showProjectTypeButtons(chatId);
});

console.log('Alfalf AI bot is running...');
