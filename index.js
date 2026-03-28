const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const ALFALF_SYSTEM_PROMPT = require('./prompt');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

const REWARD_PROMPT = `
You are Alfalf AI — a Reward Structure Architect for Web3 campaigns.
Your job is to design fair, strategic reward systems that encourage real participation and discourage farming and favoritism.

You will receive:
- The campaign structure that was already generated
- The user's reward pool and number of winners

Use the campaign context to make your reward recommendation relevant and specific.

When given a reward pool and number of winners, you must:

1. 🏆 Recommend a Reward Model
Suggest the best reward structure for this campaign. Choose from:
- Tiered distribution (top performers earn more, but fairly spread)
- Hybrid leaderboard + raffle (top tier earns fixed rewards, rest enter raffle)
- Broad participation model (many small rewards, encourages volume)
- Contribution-based (rewards tied to quality of contribution, not just quantity)
Explain why this model fits this specific campaign.

2. 💰 Example Distribution
Provide a clear example breakdown based on the user's input.
Label it clearly as: "Example distribution based on your inputs"
Keep it simple and readable on mobile.

3. ⚠️ Favoritism Risk Flags
Identify if the structure could be exploited by internal teams or moderators.
Flag top-heavy distributions that could discourage participation.
Suggest transparency measures (public leaderboard, on-chain verification).

4. 🤖 Farming Risk Flags
Identify if the reward structure encourages multi-accounting or bot farming.
Flag raffle systems with low-effort tasks.
Suggest effort-based qualifications before reward eligibility.

5. 🎲 Raffle Recommendation
If the campaign deserves to reward many participants, suggest a raffle model.
Explain when raffle works and when it doesn't.

OUTPUT RULES:
- Clear and readable on Telegram mobile
- Use bullet points, keep it practical
- Frame example as suggestion, not instruction
- Be direct about risks — do not soften feedback
- Keep the tone strategic and confident

TONE: Confident. Strategic. Practical. Not robotic.
`;

// Track user states and memory
const userStates = {};

// Split long messages for Telegram
function sendLongMessage(chatId, text) {
  const maxLength = 4000;
  for (let i = 0; i < text.length; i += maxLength) {
    bot.sendMessage(chatId, text.substring(i, i + maxLength));
  }
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, WELCOME_MESSAGE);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates[chatId]?.step;

  // State: waiting for reward pool input
  if (state === 'awaiting_reward') {
    userStates[chatId].step = null;

    bot.sendChatAction(chatId, 'typing');
    bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your reward structure...');

    try {
      const lastCampaign = userStates[chatId]?.lastCampaign || '';

      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: REWARD_PROMPT },
          {
            role: 'user',
            content: `Campaign context:\n${lastCampaign}\n\nUser reward input:\n${text}`
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const result = response.choices[0]?.message?.content;

      if (result) {
        sendLongMessage(chatId, result);
      } else {
        bot.sendMessage(chatId, '⚠️ Something went wrong while generating your reward structure.\n\nPlease try again — or simplify your input if it was very long.');
      }

    } catch (error) {
      console.error('Groq API error (reward):', error);
      bot.sendMessage(chatId, '⚠️ Something went wrong while generating your reward structure.\n\nPlease try again — or simplify your input if it was very long.');
    }

    return;
  }

  // State: waiting for yes/no on reward structure
  if (state === 'awaiting_reward_confirmation') {
    const isYes = /(yes|yeah|yep|sure|ok|okay)/i.test(text);
    const isNo = /(no|nah|nope)/i.test(text);

    if (isYes) {
      userStates[chatId].step = 'awaiting_reward';
      bot.sendMessage(chatId, `💰 Please provide your reward details in this format:

💰 Reward pool: $0000
🏆 Number of winners: 000

Example:
💰 Reward pool: $500
🏆 Number of winners: 20`);
      return;
    }

    if (isNo) {
      userStates[chatId].step = null;
      bot.sendMessage(chatId, `Got it 👍

If you want to refine the campaign later or test another idea, just send a new brief.`);
      return;
    }

    // Not a clear yes or no
    bot.sendMessage(chatId, `Please reply with Yes or No.

Would you like me to design a fair reward structure for this campaign? 🎯`);
    return;
  }

  // Default: expecting campaign input
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

  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your campaign system...');

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ALFALF_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0.7,
      max_tokens: 1800,
    });

    const result = response.choices[0]?.message?.content;

    if (result) {
      sendLongMessage(chatId, result);

      // Save campaign to memory
      userStates[chatId] = {
        step: 'awaiting_reward_confirmation',
        lastCampaign: result,
        lastInput: text
      };

      setTimeout(() => {
        bot.sendMessage(chatId, REWARD_QUESTION);
      }, 1000);

    } else {
      bot.sendMessage(chatId, '⚠️ Something went wrong while generating your campaign.\n\nPlease try again — or simplify your input if it was very long.');
    }

  } catch (error) {
    console.error('Groq API error (campaign):', error);
    bot.sendMessage(chatId, '⚠️ Something went wrong while generating your campaign.\n\nPlease try again — or simplify your input if it was very long.');
  }
});

console.log('Alfalf AI bot is running...');
