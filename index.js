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

When given a reward pool and number of winners, you must:

1. 🏆 Recommend a Reward Model
Suggest the best reward structure for this campaign. Choose from:
- Tiered distribution (top performers earn more, but fairly spread)
- Hybrid leaderboard + raffle (top tier earns fixed rewards, rest enter raffle)
- Broad participation model (many small rewards, encourages volume)
- Contribution-based (rewards tied to quality of contribution, not just quantity)
Explain why this model fits the campaign.

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

const userStates = {};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, WELCOME_MESSAGE);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates[chatId];

  // State: waiting for reward pool input
  if (state === 'awaiting_reward') {
    userStates[chatId] = null;

    bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your reward structure...');

    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: REWARD_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const result = response.choices[0]?.message?.content;

      if (result) {
        bot.sendMessage(chatId, result);
      } else {
        bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
      }

    } catch (error) {
      console.error('Groq API error (reward):', error);
      bot.sendMessage(chatId, '❌ Error generating reward structure. Please try again.');
    }

    return;
  }

  // State: waiting for yes/no on reward structure
  if (state === 'awaiting_reward_confirmation') {
    const lowerText = text.toLowerCase().trim();
    const isYes = ['yes', 'yeah', 'sure', 'yep', 'y', 'ok', 'okay'].includes(lowerText);
    const isNo = ['no', 'nope', 'nah', 'n'].includes(lowerText);

    if (isYes) {
      userStates[chatId] = 'awaiting_reward';
      bot.sendMessage(chatId, `💰 Please provide your reward details in this format:

💰 Reward pool: $0000
🏆 Number of winners: 000

Example:
💰 Reward pool: $500
🏆 Number of winners: 20`);
      return;
    }

    if (isNo) {
      userStates[chatId] = null;
      bot.sendMessage(chatId, `No problem. Good luck with your campaign! 🌱

If you need anything else, just send a new project brief.`);
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
      await bot.sendMessage(chatId, result);
      userStates[chatId] = 'awaiting_reward_confirmation';
      await bot.sendMessage(chatId, REWARD_QUESTION);
    } else {
      bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
    }

  } catch (error) {
    console.error('Groq API error (campaign):', error);
    bot.sendMessage(chatId, '❌ Error generating campaign. Please try again.');
  }
});

console.log('Alfalf AI bot is running...');
